import {
  type BotModule,
  defineCommand,
  defineSubcommand,
  fitLines,
  MANAGE_GUILD,
  MAX_PREFIX_LENGTH,
  prefixProblem,
  requireGuild,
  UserError,
} from "@dzajcarz/core";

/** Where a guild's custom prefix lives. `forget`-style cache invalidation is the implementation's job. */
export interface PrefixSettings {
  /** The guild's own prefix, or null when it uses the default. */
  get(guildId: string): Promise<string | null>;
  set(guildId: string, prefix: string): Promise<void>;
  /** Back to the default prefix. */
  reset(guildId: string): Promise<void>;
}

/** One place a module is switched off. */
export interface DisabledModule {
  module: string;
  /** null: the whole server. */
  channelId: string | null;
}

/** Which modules a guild has switched off. Cache invalidation is the implementation's job. */
export interface ModuleToggles {
  /** Every module the bot runs. */
  moduleNames(): readonly string[];
  list(guildId: string): Promise<readonly DisabledModule[]>;
  disable(guildId: string, module: string, channelId: string | null): Promise<void>;
  /** False when that module was not disabled there. */
  enable(guildId: string, module: string, channelId: string | null): Promise<boolean>;
}

/** Asks Discord about channels, so a channel id typed by a member is never trusted on its own. */
export interface GuildChannels {
  /** Whether the channel exists and belongs to this guild. */
  belongsTo(guildId: string, channelId: string): Promise<boolean>;
  /** Whether the channel is a thread; toggles follow the parent channel, so threads cannot be switched. */
  isThread(guildId: string, channelId: string): Promise<boolean>;
}

export interface SettingsModuleDeps {
  prefixes: PrefixSettings;
  defaultPrefix: string;
  modules: ModuleToggles;
  channels: GuildChannels;
}

/** Modules that stay on: without them nobody could turn anything back on or ask for help. `status` has no per-server behaviour, so a toggle would do nothing. */
export const PROTECTED_MODULES: ReadonlySet<string> = new Set(["general", "settings", "status"]);

const MAX_ECHOED_NAME = 32;
/** The /modules list stays well under Discord's 2000; fitLines keeps room for its "… i jeszcze N" line. */
const MAX_LIST_LENGTH = 1900;
const MAX_CHANNELS_PER_LINE = 10;

const PREFIX_PROBLEMS = {
  length: `يجب أن يتكون البادئة من 1 إلى ${MAX_PREFIX_LENGTH} أحرف.`,
  whitespace: "لا يمكن أن تحتوي البادئة على مسافات أو أحرف غير مرئية.",
  backtick: "لا يمكن أن تحتوي البادئة على الرمز `.",
} as const;

/** Throws a UserError (Polish) when the prefix breaks the core rule. */
function validatePrefix(prefix: string): void {
  const problem = prefixProblem(prefix);
  if (problem) throw new UserError(PREFIX_PROBLEMS[problem]);
}

export function createSettingsModule({
  prefixes,
  defaultPrefix,
  modules,
  channels,
}: SettingsModuleDeps): BotModule {
  // These commands keep the default `contexts` (servers only), so guildId is set when they run; the check
  // below narrows the type and guards a future change of contexts.
  const prefix = defineCommand({
    name: "prefix",
    description: "يعرض بادئة الأوامر في هذا الخادم أو يغيّرها",
    permissions: MANAGE_GUILD,
    subcommands: {
      set: defineSubcommand({
        description: "يضبط بادئة الأوامر النصية",
        options: {
          prefix: {
            type: "string",
            description: "البادئة الجديدة (من 1 إلى 5 أحرف)",
            required: true,
          },
        },
        run: async (ctx) => {
          validatePrefix(ctx.args.prefix);
          await prefixes.set(requireGuild(ctx.guildId), ctx.args.prefix);
          await ctx.reply({ content: `البادئة الآن هي \`${ctx.args.prefix}\`.`, ephemeral: true });
        },
      }),
      reset: defineSubcommand({
        description: "يعيد البادئة الافتراضية",
        run: async (ctx) => {
          await prefixes.reset(requireGuild(ctx.guildId));
          await ctx.reply({
            content: `تمت استعادة البادئة الافتراضية \`${defaultPrefix}\`.`,
            ephemeral: true,
          });
        },
      }),
      show: defineSubcommand({
        description: "يعرض البادئة الحالية",
        run: async (ctx) => {
          const current = (await prefixes.get(requireGuild(ctx.guildId))) ?? defaultPrefix;
          await ctx.reply({
            content: `البادئة في هذا الخادم هي \`${current}\`. يمكنك أيضًا الإشارة إلى البوت.`,
            ephemeral: true,
          });
        },
      }),
    },
  });

  /** Throws a UserError (Polish) listing the valid names unless `name` is a module that can be toggled. */
  const toggleable = (name: string): string => {
    const module = name.toLowerCase();
    const known = modules.moduleNames();
    if (!known.includes(module)) {
      const valid = known.filter((n) => !PROTECTED_MODULES.has(n));
      // The name is echoed inside a code span: a backtick would close it, and length is capped for Discord's limit.
      const shown = name.replaceAll("`", "").slice(0, MAX_ECHOED_NAME);
      throw new UserError(
        `لا توجد وحدة باسم \`${shown}\`. الوحدات المتاحة: ${valid.map((n) => `\`${n}\``).join(", ") || "لا شيء"}.`,
      );
    }
    if (PROTECTED_MODULES.has(module)) {
      throw new UserError(`لا يمكن تعطيل الوحدة \`${module}\`.`);
    }
    return module;
  };

  /**
   * The channel option is only an id, so check that it is a channel of this guild before storing it.
   * `enable` skips this: a row for a deleted channel must stay removable.
   */
  const requireToggleableChannel = async (guildId: string, channelId: string | null) => {
    if (channelId === null) return;
    if (!(await channels.belongsTo(guildId, channelId))) {
      throw new UserError("لم أعثر على هذه القناة في هذا الخادم.");
    }
    if (await channels.isThread(guildId, channelId)) {
      throw new UserError(
        "ترث سلاسل المحادثة إعدادات القناة الأصلية. اختر القناة التي توجد فيها السلسلة.",
      );
    }
  };

  const where = (channelId: string | null) =>
    channelId ? `في القناة <#${channelId}>` : "في الخادم";

  const modulesCommand = defineCommand({
    name: "modules",
    description: "يفعّل وحدات البوت أو يعطّلها في الخادم أو قناة محددة",
    permissions: MANAGE_GUILD,
    subcommands: {
      list: defineSubcommand({
        description: "يعرض الوحدات والأماكن التي تم تعطيلها فيها",
        run: async (ctx) => {
          const disabled = await modules.list(requireGuild(ctx.guildId));
          const lines = modules.moduleNames().map((name) => {
            const entries = disabled.filter((d) => d.module === name);
            if (entries.length === 0) return `\`${name}\`: مفعّل`;
            if (entries.some((d) => d.channelId === null)) return `\`${name}\`: معطّل في الخادم`;
            const shown = entries.slice(0, MAX_CHANNELS_PER_LINE).map((d) => `<#${d.channelId}>`);
            const hidden = entries.length - shown.length;
            const more = hidden > 0 ? ` و${hidden} أخرى` : "";
            return `\`${name}\`: معطّل في القنوات ${shown.join(", ")}${more}`;
          });
          await ctx.reply({ content: fitLines(lines, MAX_LIST_LENGTH), ephemeral: true });
        },
      }),
      disable: defineSubcommand({
        description: "يعطّل الوحدة في الخادم أو قناة واحدة",
        options: {
          module: { type: "string", description: "اسم الوحدة", required: true },
          channel: { type: "channel", description: "القناة (الخادم بأكمله افتراضيًا)" },
        },
        run: async (ctx) => {
          const module = toggleable(ctx.args.module);
          const channelId = ctx.args.channel ?? null;
          const guildId = requireGuild(ctx.guildId);
          await requireToggleableChannel(guildId, channelId);
          await modules.disable(guildId, module, channelId);
          await ctx.reply({
            content: `الوحدة \`${module}\` معطّلة ${where(channelId)}.`,
            ephemeral: true,
          });
        },
      }),
      enable: defineSubcommand({
        description: "يعيد تفعيل الوحدة في الخادم أو قناة واحدة",
        options: {
          module: { type: "string", description: "اسم الوحدة", required: true },
          channel: { type: "channel", description: "القناة (الخادم بأكمله افتراضيًا)" },
        },
        run: async (ctx) => {
          const module = toggleable(ctx.args.module);
          const channelId = ctx.args.channel ?? null;
          const guildId = requireGuild(ctx.guildId);
          const changed = await modules.enable(guildId, module, channelId);
          await ctx.reply({
            content: changed
              ? `تمت إعادة تفعيل الوحدة \`${module}\` ${where(channelId)}.`
              : `لم تكن الوحدة \`${module}\` معطّلة ${where(channelId)}.`,
            ephemeral: true,
          });
        },
      }),
    },
  });

  return { name: "settings", commands: [prefix, modulesCommand] };
}
