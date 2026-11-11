import {
  type BotModule,
  type ButtonSpec,
  type CommandContext,
  type ComponentContext,
  createComponentStateStore,
  createPaginator,
  defineButton,
  defineCommand,
  defineEvent,
  defineSelect,
  type Logger,
  PUBLIC_OWNER,
  requireGuild,
  type Scheduler,
  type StateStorage,
  UserError,
} from "@dzajcarz/core";
import {
  escapeMarkdown,
  formatDuration,
  httpUrl,
  parseQuery,
  parseTime,
  truncate,
} from "./format.ts";
import {
  FILTER_LABELS,
  LOOP_LABELS,
  PANEL_COLOR,
  panelMessage,
  queueLine,
  settingsLine,
  trackEmbed,
  tracksWord,
} from "./panel.ts";
import type {
  DirectMessages,
  LoopMode,
  MusicFilter,
  MusicPlayer,
  MusicQuery,
  MusicTrack,
  PanelMessages,
  PlayerState,
  VoiceChannels,
} from "./ports.ts";

export * from "./ports.ts";

export interface MusicModuleDeps {
  player: MusicPlayer;
  voice: VoiceChannels;
  panels: PanelMessages;
  /** `/save` sends the track this way. */
  directMessages: DirectMessages;
  /** Runs the idle timeout. */
  scheduler: Scheduler;
  /** Holds `/search` results until the member picks one (ADR 6 component state). */
  stateStorage: StateStorage;
  logger: Logger;
  /** How long the bot stays with an empty queue or an empty channel. */
  idleMs?: number;
}

const MODULE = "music";
export const IDLE_MS = 3 * 60_000;
/** Failed tracks after the first note within this window are counted and reported once at its end. */
export const FAILED_NOTE_WINDOW_MS = 10_000;
/** Per user, for `/play` and `/search`. */
export const SEARCH_COOLDOWN_MS = 3_000;
/** A playlist adds at most this many tracks. */
export const MAX_PLAYLIST_TRACKS = 100;
/** Current track plus everything queued. */
export const MAX_QUEUE_LENGTH = 500;
/** Discord allows 25 options; ten results are enough to choose from. */
const MAX_SEARCH_RESULTS = 10;
const QUEUE_PAGE_SIZE = 10;
export const MAX_VOLUME = 150;
const LOOP_ORDER: readonly LoopMode[] = ["off", "track", "queue"];

/** What the prefix forms of `/loop` and `/filter` accept, in English and Polish. */
const LOOP_WORDS: Readonly<Record<string, LoopMode>> = {
  off: "off",
  wyłącz: "off",
  wyłączona: "off",
  track: "track",
  utwór: "track",
  queue: "queue",
  kolejka: "queue",
};
const FILTER_WORDS: Readonly<Record<string, MusicFilter>> = {
  bassboost: "bassboost",
  bas: "bassboost",
  nightcore: "nightcore",
  vaporwave: "vaporwave",
  "8d": "8d",
  off: "off",
  wyłącz: "off",
};
/** `Object.hasOwn` keeps words like `constructor` from reaching the prototype. */
const wordIn = <T>(words: Readonly<Record<string, T>>, input: string): T | undefined => {
  const word = input.trim().toLowerCase();
  return Object.hasOwn(words, word) ? words[word] : undefined;
};

export const UNAVAILABLE = "مشغل الموسيقى غير متاح حاليًا.";
export const NOT_IN_VOICE = "ادخل إلى قناة صوتية أولًا.";
export const NOTHING_PLAYING = "لا يتم تشغيل أي شيء الآن.";
export const UNSUPPORTED_LINK = "أدعم الروابط من YouTube وBandcamp وTwitch وVimeo فقط.";
export const trackFailedText = (title: string) =>
  `تعذّر تشغيل **${escapeMarkdown(title)}**، سأتابع التشغيل.`;
export const moreTracksFailedText = (count: number) =>
  `المقاطع التالية لا تعمل أيضًا، تم تجاوزها: ${count}.`;
export const EMPTY_QUEUE = "قائمة الانتظار فارغة.";
export const queueChanged = "تغيّرت قائمة الانتظار، حاول مرة أخرى.";
export const otherChannel = (channelId: string) =>
  `يجب أن تكون في القناة <#${channelId}> التي أشغّل فيها الموسيقى.`;

interface PendingSearch {
  tracks: MusicTrack[];
}

export function createMusicModule({
  player,
  voice,
  panels,
  directMessages,
  scheduler,
  stateStorage,
  logger,
  idleMs = IDLE_MS,
}: MusicModuleDeps): BotModule {
  const searches = createComponentStateStore(stateStorage);

  // Commands are guild-only by default and the components declare guildOnly, so this never fires.
  const guildOf = (ctx: Pick<CommandContext, "guildId">) =>
    requireGuild(ctx.guildId, "تعمل الموسيقى في الخوادم فقط.");

  /** The member's input as a query; a link to another site is refused here. */
  function queryOf(input: string, emptyText: string): MusicQuery {
    const query = parseQuery(input);
    if (!query) throw new UserError(emptyText);
    if (query.kind === "unsupported") throw new UserError(UNSUPPORTED_LINK);
    return query;
  }

  /**
   * The caller must be in a voice channel, and in the bot's once the bot plays in the guild. Returns
   * the caller's channel and the guild's player, if any. `needsNode: false` lets a command that only
   * tears down (stop) through while the node is away.
   */
  async function requireListener(guildId: string, userId: string, needsNode = true) {
    if (needsNode && !player.available()) throw new UserError(UNAVAILABLE);
    const channelId = await voice.channelOf(guildId, userId);
    if (channelId === null) throw new UserError(NOT_IN_VOICE);
    const state = player.state(guildId);
    if (state && state.voiceChannelId !== channelId) {
      throw new UserError(otherChannel(state.voiceChannelId));
    }
    return { channelId, state };
  }

  /** Like `requireListener`, for controls: there must be something to control. */
  async function requireControl(
    guildId: string,
    userId: string,
    needsNode = true,
  ): Promise<PlayerState> {
    if (needsNode && !player.available()) throw new UserError(UNAVAILABLE);
    if (!player.state(guildId)) throw new UserError(NOTHING_PLAYING);
    const { state } = await requireListener(guildId, userId, needsNode);
    if (!state) throw new UserError(NOTHING_PLAYING);
    return state;
  }

  /** Additions run one at a time per guild: two quick `/play`s must not both join or both "start". */
  const additions = new Map<string, Promise<unknown>>();

  function oneAtATime<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    const result = (additions.get(guildId) ?? Promise.resolve()).then(task);
    const settled = result.catch(() => {});
    additions.set(guildId, settled);
    void settled.then(() => {
      if (additions.get(guildId) === settled) additions.delete(guildId);
    });
    return result;
  }

  /**
   * Adds tracks for a member, joining first when the bot is not in voice. The voice rules, the queue cap
   * and the "starts now" answer are all decided from the state inside the per-guild chain, so they see
   * what an addition just before did. Returns what was accepted and whether playback starts with it.
   */
  function addTracks(
    guildId: string,
    userId: string,
    textChannelId: string,
    tracks: readonly MusicTrack[],
  ) {
    return oneAtATime(guildId, async () => {
      // The caller may have moved since the command started, or another addition made the bot join.
      const { channelId, state } = await requireListener(guildId, userId);
      const queued = state ? state.upcoming.length + (state.current ? 1 : 0) : 0;
      const room = MAX_QUEUE_LENGTH - queued;
      if (room <= 0) throw new UserError(`قائمة الانتظار ممتلئة (${MAX_QUEUE_LENGTH} مقطعًا).`);
      const accepted = tracks.slice(0, room);
      // Joining a song the bot plays on its own makes this channel the panel's for the tracks to come.
      if (!state || state.current?.byBot) await player.join(guildId, channelId, textChannelId);
      await player.enqueue(guildId, accepted);
      const startsNow = !state?.current;
      // A new track redraws the panel by itself; otherwise only its queue count changed.
      if (!startsNow) void inOrder(guildId, () => showPanel(guildId));
      void reviewIdle(guildId);
      return { accepted, startsNow, position: queued };
    });
  }

  const nextLoop = (mode: LoopMode): LoopMode =>
    LOOP_ORDER[(LOOP_ORDER.indexOf(mode) + 1) % LOOP_ORDER.length] ?? "off";

  /** Mixes the upcoming tracks; shared by `/shuffle` and its panel button. */
  function shuffleQueue(guildId: string, userId: string): Promise<void> {
    return oneAtATime(guildId, async () => {
      const state = await requireControl(guildId, userId);
      if (state.upcoming.length < 2) {
        throw new UserError("لا توجد مقاطع كافية في قائمة الانتظار للخلط.");
      }
      await player.shuffle(guildId);
    });
  }

  function addedText(track: MusicTrack, startsNow: boolean, position: number): string {
    const title = `**${escapeMarkdown(track.title)}** (${track.isStream ? "مباشر" : formatDuration(track.durationMs)})`;
    return startsNow
      ? `يعمل الآن: ${title}.`
      : `أُضيف إلى قائمة الانتظار في الموضع ${position}: ${title}.`;
  }

  const pauseButton = defineButton({
    module: MODULE,
    name: "panel-pause",
    public: true,
    guildOnly: true,
    async run(ctx) {
      const guildId = guildOf(ctx);
      const state = await requireControl(guildId, ctx.user.id);
      if (state.paused) await player.resume(guildId);
      else await player.pause(guildId);
      await updatePanelFromClick(ctx, guildId);
    },
  });

  const skipButton = defineButton({
    module: MODULE,
    name: "panel-skip",
    public: true,
    guildOnly: true,
    async run(ctx) {
      const guildId = guildOf(ctx);
      // Answer the click first: Discord gives three seconds, and the skip waits for the node.
      await ctx.defer();
      const state = await requireControl(guildId, ctx.user.id);
      if (!state.current) throw new UserError(NOTHING_PLAYING);
      // The next trackStart (or queueEnd) redraws the panel.
      await player.skip(guildId, state.current.id);
    },
  });

  const stopButton = defineButton({
    module: MODULE,
    name: "panel-stop",
    public: true,
    guildOnly: true,
    async run(ctx) {
      const guildId = guildOf(ctx);
      // Acknowledged before playerDestroyed deletes the panel this button sits on.
      await ctx.defer();
      await requireControl(guildId, ctx.user.id, false);
      // playerDestroyed removes the panel.
      await player.leave(guildId);
    },
  });

  const queueButton = defineButton({
    module: MODULE,
    name: "panel-queue",
    public: true,
    guildOnly: true,
    async run(ctx) {
      await ctx.reply({ ...(await queuePages.first(ctx)), ephemeral: true });
    },
  });

  const loopButton = defineButton({
    module: MODULE,
    name: "panel-loop",
    public: true,
    guildOnly: true,
    async run(ctx) {
      const guildId = guildOf(ctx);
      // In the chain, so a double click reads the mode the first click set and moves on from there.
      await oneAtATime(guildId, async () => {
        const state = await requireControl(guildId, ctx.user.id);
        await player.setLoop(guildId, nextLoop(state.loop));
      });
      await updatePanelFromClick(ctx, guildId);
    },
  });

  const shuffleButton = defineButton({
    module: MODULE,
    name: "panel-shuffle",
    public: true,
    guildOnly: true,
    async run(ctx) {
      const guildId = guildOf(ctx);
      await shuffleQueue(guildId, ctx.user.id);
      await updatePanelFromClick(ctx, guildId);
    },
  });

  const buttons = {
    loop: (mode: LoopMode): ButtonSpec => ({
      type: "button",
      customId: loopButton.customId(PUBLIC_OWNER),
      label: `التكرار: ${LOOP_LABELS[mode]}`,
      emoji: mode === "track" ? "🔂" : "🔁",
      style: mode === "off" ? "secondary" : "success",
    }),
    shuffle: {
      type: "button",
      customId: shuffleButton.customId(PUBLIC_OWNER),
      label: "عشوائي",
      emoji: "🔀",
      style: "secondary",
    },
    pause: (paused: boolean): ButtonSpec => ({
      type: "button",
      customId: pauseButton.customId(PUBLIC_OWNER),
      label: paused ? "استئناف" : "إيقاف مؤقت",
      emoji: paused ? "▶️" : "⏸️",
      style: "primary",
    }),
    skip: {
      type: "button",
      customId: skipButton.customId(PUBLIC_OWNER),
      label: "التالي",
      emoji: "⏭️",
      style: "secondary",
    },
    stop: {
      type: "button",
      customId: stopButton.customId(PUBLIC_OWNER),
      label: "إيقاف",
      emoji: "⏹️",
      style: "danger",
    },
    queue: {
      type: "button",
      customId: queueButton.customId(PUBLIC_OWNER),
      label: "قائمة الانتظار",
      emoji: "📜",
      style: "secondary",
    },
  } satisfies Parameters<typeof panelMessage>[1];

  /** The posted panel of each guild. */
  const posted = new Map<string, { channelId: string; messageId: string }>();
  /** Panel work runs one at a time per guild, so two quick track changes never post two panels. */
  const panelWork = new Map<string, Promise<void>>();

  function inOrder(guildId: string, task: () => Promise<void>): Promise<void> {
    const next = (panelWork.get(guildId) ?? Promise.resolve()).then(task).catch((error) => {
      logger.warn("Now playing panel update failed", { guildId, error });
    });
    panelWork.set(guildId, next);
    void next.then(() => {
      if (panelWork.get(guildId) === next) panelWork.delete(guildId);
    });
    return next;
  }

  async function showPanel(guildId: string): Promise<void> {
    const state = player.state(guildId);
    const message = state && panelMessage(state, buttons);
    if (!state || !message) return;
    const existing = posted.get(guildId);
    if (existing?.channelId === state.textChannelId) {
      let edited: "edited" | "gone";
      try {
        edited = await panels.edit(existing.channelId, existing.messageId, message);
      } catch (error) {
        // Discord refused for another reason (rate limit, outage): keep the panel, the next change retries.
        logger.warn("Editing the now playing panel failed", { guildId, error });
        return;
      }
      if (edited === "edited") return;
      // Someone deleted the panel or its channel: post a fresh one.
    } else if (existing) {
      await panels.delete(existing.channelId, existing.messageId).catch(() => {});
    }
    posted.delete(guildId);
    const messageId = await panels.post(state.textChannelId, message);
    posted.set(guildId, { channelId: state.textChannelId, messageId });
  }

  async function removePanel(guildId: string): Promise<void> {
    const existing = posted.get(guildId);
    if (!existing) return;
    posted.delete(guildId);
    await panels.delete(existing.channelId, existing.messageId);
  }

  /** Pause and resume redraw the panel; a click on the panel edits it through the interaction. */
  async function updatePanelFromClick(ctx: ComponentContext, guildId: string): Promise<void> {
    const state = player.state(guildId);
    const message = state && panelMessage(state, buttons);
    if (message) await ctx.update(message);
  }

  const idleTimers = new Map<string, () => void>();

  function cancelIdle(guildId: string): void {
    idleTimers.get(guildId)?.();
    idleTimers.delete(guildId);
  }

  /** Nothing playing, or nobody but bots listening. */
  async function isIdle(guildId: string): Promise<boolean | null> {
    const state = player.state(guildId);
    if (!state) return null;
    if (state.current === null) return true;
    return (await voice.humanCount(guildId, state.voiceChannelId)) === 0;
  }

  /** Arms the leave timer when the guild's player became idle, disarms it when it is busy again. */
  async function reviewIdle(guildId: string): Promise<void> {
    try {
      const idle = await isIdle(guildId);
      if (!idle) {
        cancelIdle(guildId);
        return;
      }
      if (idleTimers.has(guildId)) return;
      const cancel = scheduler.after(idleMs, () => {
        idleTimers.delete(guildId);
        void leaveIfIdle(guildId);
      });
      idleTimers.set(guildId, cancel);
    } catch (error) {
      logger.warn("Checking whether the player is idle failed", { guildId, error });
    }
  }

  async function leaveIfIdle(guildId: string): Promise<void> {
    try {
      if (!(await isIdle(guildId))) return;
      logger.info("Leaving an idle voice channel", { guildId });
      await player.leave(guildId);
    } catch (error) {
      logger.warn("Leaving an idle voice channel failed", { guildId, error });
    }
  }

  /** Guilds inside a failed-track window: how many failures came after its first note. */
  const failedBursts = new Map<string, { skipped: number; cancel: () => void }>();

  const unsubscribe = player.subscribe({
    trackStart(guildId) {
      void inOrder(guildId, () => showPanel(guildId));
      void reviewIdle(guildId);
    },
    queueEnd(guildId) {
      void inOrder(guildId, () => removePanel(guildId));
      void reviewIdle(guildId);
    },
    playerDestroyed(guildId) {
      cancelIdle(guildId);
      // A note after the bot left would be noise, and the next session starts its own window.
      failedBursts.get(guildId)?.cancel();
      failedBursts.delete(guildId);
      void inOrder(guildId, () => removePanel(guildId));
    },
    trackFailed(guildId, track) {
      if (track.byBot) return;
      const burst = failedBursts.get(guildId);
      if (burst) {
        burst.skipped++;
        return;
      }
      const channelId = player.state(guildId)?.textChannelId;
      if (!channelId) return;
      postFailedNote(guildId, channelId, trackFailedText(track.title));
      // A playlist full of removed videos fails track after track; one note per window keeps the chat usable.
      const cancel = scheduler.after(FAILED_NOTE_WINDOW_MS, () => {
        const ended = failedBursts.get(guildId);
        failedBursts.delete(guildId);
        if (ended && ended.skipped > 0) {
          postFailedNote(guildId, channelId, moreTracksFailedText(ended.skipped));
        }
      });
      failedBursts.set(guildId, { skipped: 0, cancel });
    },
  });

  function postFailedNote(guildId: string, channelId: string, content: string): void {
    panels.post(channelId, { content }).catch((error: unknown) => {
      logger.warn("Posting a failed track note failed", { guildId, error });
    });
  }

  const voiceChange = defineEvent({
    name: "music-idle",
    event: "voiceStateUpdate",
    // Leaving an empty channel is cleanup: it must happen even where the module is switched off.
    alwaysRun: true,
    async run(_oldState, newState) {
      const guildId = newState.guild.id;
      if (player.state(guildId)) await reviewIdle(guildId);
    },
  });

  const guildGone = defineEvent({
    name: "music-guild-gone",
    event: "guildDelete",
    // The bot was removed from the server: nothing is left to play into. (An outage is guildUnavailable.)
    alwaysRun: true,
    async run(guild) {
      if (player.state(guild.id)) await player.leave(guild.id);
    },
  });

  const queuePages = createPaginator({
    module: MODULE,
    name: "queue-page",
    guildOnly: true,
    render({ page, viewer }) {
      const state = viewer.guildId === null ? null : player.state(viewer.guildId);
      if (!state?.current) return { content: NOTHING_PLAYING, pageCount: 1 };
      const pageCount = Math.max(1, Math.ceil(state.upcoming.length / QUEUE_PAGE_SIZE));
      const start = page * QUEUE_PAGE_SIZE;
      const lines = state.upcoming
        .slice(start, start + QUEUE_PAGE_SIZE)
        .map((track, index) => queueLine(start + index + 1, track));
      const total = state.upcoming.reduce((sum, track) => sum + track.durationMs, 0);
      return {
        embeds: [
          {
            title: "قائمة الانتظار",
            color: PANEL_COLOR,
            description: [
              `**الآن:** ${escapeMarkdown(truncate(state.current.title, 80))}`,
              "",
              lines.length > 0 ? lines.join("\n") : "لا توجد مقاطع أخرى في قائمة الانتظار.",
            ].join("\n"),
            footer:
              state.upcoming.length === 0
                ? undefined
                : `${state.upcoming.length} ${tracksWord(state.upcoming.length)} · ${formatDuration(total)}`,
          },
        ],
        pageCount,
      };
    },
  });

  const queryOption = {
    query: {
      type: "string",
      description: "رابط (YouTube…) أو ما تريد البحث عنه",
      required: true,
      rest: true,
    },
  } as const;

  const play = defineCommand({
    name: "play",
    description: "يشغّل مقطعًا أو قائمة تشغيل من رابط أو بحث",
    aliases: ["p"],
    options: queryOption,
    // Each call is a YouTube lookup through Lavalink; spamming it risks a block for everyone.
    cooldownMs: SEARCH_COOLDOWN_MS,
    async run(ctx) {
      const guildId = guildOf(ctx);
      const query = queryOf(ctx.args.query, "أدخل رابطًا أو ما تريد البحث عنه.");
      await requireListener(guildId, ctx.user.id);
      await ctx.defer();
      const result = await player.search(query, ctx.user.id);
      if (result.kind === "error") {
        logger.info("Loading a track failed", { guildId, query, message: result.message });
        throw new UserError("تعذّر تحميل هذا المقطع.");
      }
      if (result.kind === "empty" || result.tracks.length === 0) {
        throw new UserError("لم يتم العثور على شيء.");
      }
      // A search returns many matches; only the first one is meant.
      const wanted =
        result.kind === "playlist"
          ? result.tracks.slice(0, MAX_PLAYLIST_TRACKS)
          : result.tracks.slice(0, 1);
      // addTracks checks the voice rules again: the search took a while.
      const added = await addTracks(guildId, ctx.user.id, ctx.channelId, wanted);
      if (result.kind !== "playlist") {
        const [track] = added.accepted;
        if (track) await ctx.reply(addedText(track, added.startsNow, added.position));
        return;
      }
      const count = added.accepted.length;
      const skipped = result.tracks.length - count;
      const note =
        skipped === 0
          ? ""
          : ` تم تجاوز ${skipped} (يمكن لقائمة التشغيل إضافة ${MAX_PLAYLIST_TRACKS} مقطعًا كحد أقصى، وتستوعب القائمة ${MAX_QUEUE_LENGTH}).`;
      await ctx.reply(
        `أُضيف ${count} ${tracksWord(count)} من قائمة التشغيل **${escapeMarkdown(result.name)}**.${note}`,
      );
    },
  });

  const pick = defineSelect({
    module: MODULE,
    name: "search-pick",
    guildOnly: true,
    async run(ctx) {
      const guildId = guildOf(ctx);
      const { tracks } = await searches.load<PendingSearch>(ctx.state);
      const track = tracks[Number(ctx.values[0])];
      if (!track) throw new UserError("لا توجد هذه النتيجة.");
      // Joining the voice channel can take longer than the 3 s Discord gives a click to be answered.
      await ctx.defer();
      const added = await addTracks(guildId, ctx.user.id, ctx.channelId, [track]);
      await ctx.update({
        content: addedText(track, added.startsNow, added.position),
        components: [],
      });
    },
  });

  const search = defineCommand({
    name: "search",
    description: "يبحث في YouTube ويسمح باختيار إحدى النتائج",
    options: queryOption,
    cooldownMs: SEARCH_COOLDOWN_MS,
    async run(ctx) {
      const guildId = guildOf(ctx);
      const query = queryOf(ctx.args.query, "أدخل ما تريد البحث عنه.");
      await requireListener(guildId, ctx.user.id);
      await ctx.defer({ ephemeral: true });
      const result = await player.search(query, ctx.user.id);
      if (result.kind === "error") {
        logger.info("Search failed", { guildId, query, message: result.message });
        throw new UserError("فشل البحث.");
      }
      const tracks = result.kind === "empty" ? [] : result.tracks.slice(0, MAX_SEARCH_RESULTS);
      if (tracks.length === 0) throw new UserError("لم يتم العثور على شيء.");
      const key = await searches.save({ tracks } satisfies PendingSearch);
      await ctx.reply({
        content: "اختر مقطعًا:",
        ephemeral: true,
        components: [
          [
            {
              type: "select",
              customId: pick.customId(ctx.user.id, key),
              placeholder: "نتائج البحث",
              options: tracks.map((track, index) => ({
                label: truncate(track.title, 100),
                value: String(index),
                description: truncate(
                  `${track.author} · ${track.isStream ? "مباشر" : formatDuration(track.durationMs)}`,
                  100,
                ),
              })),
            },
          ],
        ],
      });
    },
  });

  const queue = defineCommand({
    name: "queue",
    description: "يعرض قائمة المقاطع المنتظرة",
    async run(ctx) {
      guildOf(ctx);
      await ctx.reply({ ...(await queuePages.first(ctx)), ephemeral: true });
    },
  });

  const skip = defineCommand({
    name: "skip",
    description: "يتخطى المقطع الحالي",
    async run(ctx) {
      const guildId = guildOf(ctx);
      const state = await requireControl(guildId, ctx.user.id);
      if (!state.current) throw new UserError(NOTHING_PLAYING);
      await player.skip(guildId, state.current.id);
      await ctx.reply(`تم التخطي: **${escapeMarkdown(state.current.title)}**.`);
    },
  });

  const stop = defineCommand({
    name: "stop",
    description: "يوقف الموسيقى ويمسح القائمة ويغادر القناة",
    async run(ctx) {
      const guildId = guildOf(ctx);
      // Works while the node is away too: the bot still leaves voice.
      await requireControl(guildId, ctx.user.id, false);
      await player.leave(guildId);
      await ctx.reply("تم إيقاف الموسيقى ومسح قائمة الانتظار.");
    },
  });

  const pause = defineCommand({
    name: "pause",
    description: "يوقف التشغيل مؤقتًا",
    async run(ctx) {
      const guildId = guildOf(ctx);
      const state = await requireControl(guildId, ctx.user.id);
      if (!state.current) throw new UserError(NOTHING_PLAYING);
      if (state.paused) throw new UserError("الموسيقى متوقفة مؤقتًا بالفعل.");
      await player.pause(guildId);
      void inOrder(guildId, () => showPanel(guildId));
      await ctx.reply("تم الإيقاف المؤقت.");
    },
  });

  const resume = defineCommand({
    name: "resume",
    description: "يستأنف التشغيل",
    async run(ctx) {
      const guildId = guildOf(ctx);
      const state = await requireControl(guildId, ctx.user.id);
      if (!state.paused) throw new UserError("الموسيقى ليست متوقفة مؤقتًا.");
      await player.resume(guildId);
      void inOrder(guildId, () => showPanel(guildId));
      await ctx.reply("تم الاستئناف.");
    },
  });

  const nowPlaying = defineCommand({
    name: "nowplaying",
    description: "يعرض ما يتم تشغيله الآن",
    aliases: ["np"],
    async run(ctx) {
      const state = player.state(guildOf(ctx));
      if (!state?.current) throw new UserError(NOTHING_PLAYING);
      const embed = trackEmbed(
        state.current,
        state.positionMs,
        state.upcoming.length,
        settingsLine(state),
      );
      await ctx.reply({
        embeds: [
          { ...embed, footer: state.paused ? `متوقف مؤقتًا · ${embed.footer}` : embed.footer },
        ],
      });
    },
  });

  const redrawPanel = (guildId: string) => void inOrder(guildId, () => showPanel(guildId));

  const loop = defineCommand({
    name: "loop",
    description: "يضبط التكرار: معطّل أو مقطع أو قائمة",
    options: {
      mode: {
        type: "string",
        description: "ما الذي سيتم تكراره",
        required: true,
        choices: [
          { name: "معطّل", value: "off" },
          { name: "مقطع", value: "track" },
          { name: "قائمة الانتظار", value: "queue" },
        ],
      },
    },
    async run(ctx) {
      const guildId = guildOf(ctx);
      const mode = wordIn(LOOP_WORDS, ctx.args.mode);
      if (!mode) {
        throw new UserError(
          "أدخل `wyłącz` أو `utwór` أو `kolejka` (أو `off` أو `track` أو `queue`).",
        );
      }
      await oneAtATime(guildId, async () => {
        await requireControl(guildId, ctx.user.id);
        await player.setLoop(guildId, mode);
      });
      redrawPanel(guildId);
      await ctx.reply(`التكرار: **${LOOP_LABELS[mode]}**.`);
    },
  });

  const shuffle = defineCommand({
    name: "shuffle",
    description: "يخلط قائمة الانتظار",
    async run(ctx) {
      const guildId = guildOf(ctx);
      await shuffleQueue(guildId, ctx.user.id);
      redrawPanel(guildId);
      await ctx.reply("تم خلط قائمة الانتظار.");
    },
  });

  const seek = defineCommand({
    name: "seek",
    description: "ينتقل داخل المقطع الحالي (مثل 1:30 أو 90 أو 1m30s)",
    options: {
      time: {
        type: "string",
        description: "إلى أين تنتقل داخل المقطع",
        required: true,
        rest: true,
      },
    },
    async run(ctx) {
      const guildId = guildOf(ctx);
      const positionMs = parseTime(ctx.args.time);
      if (positionMs === null) {
        throw new UserError("لم أفهم الوقت. أدخل مثلًا `1:30` أو `90` أو `1m30s`.");
      }
      await oneAtATime(guildId, async () => {
        const state = await requireControl(guildId, ctx.user.id);
        const current = state.current;
        if (!current) throw new UserError(NOTHING_PLAYING);
        if (current.isStream) throw new UserError("لا يمكن التقدم داخل البث المباشر.");
        if (!current.isSeekable) throw new UserError("لا يمكن التقدم داخل هذا المقطع.");
        // The end itself is allowed: the track ends and the next one plays.
        if (positionMs > current.durationMs) {
          throw new UserError(
            `مدة المقطع ${formatDuration(current.durationMs)} فقط، لا يمكن التقدم أكثر.`,
          );
        }
        if (!(await player.seek(guildId, positionMs, current.id))) {
          throw new UserError("تغيّر المقطع أثناء العملية، حاول مرة أخرى.");
        }
      });
      redrawPanel(guildId);
      await ctx.reply(`تم الانتقال إلى **${formatDuration(positionMs)}**.`);
    },
  });

  const volume = defineCommand({
    name: "volume",
    description: `يضبط مستوى الصوت (0-${MAX_VOLUME})`,
    aliases: ["vol"],
    options: {
      percent: {
        type: "integer",
        description: `مستوى الصوت بالنسبة المئوية (0-${MAX_VOLUME})`,
        required: true,
        minValue: 0,
        maxValue: MAX_VOLUME,
      },
    },
    async run(ctx) {
      const guildId = guildOf(ctx);
      const percent = ctx.args.percent;
      if (!Number.isInteger(percent) || percent < 0 || percent > MAX_VOLUME) {
        throw new UserError(`يجب أن يكون مستوى الصوت رقمًا من 0 إلى ${MAX_VOLUME}.`);
      }
      await requireControl(guildId, ctx.user.id);
      await player.setVolume(guildId, percent);
      redrawPanel(guildId);
      await ctx.reply(`مستوى الصوت: **${percent}%**.`);
    },
  });

  const filter = defineCommand({
    name: "filter",
    description: "يفعّل مؤثرًا صوتيًا أو يعطّله",
    options: {
      name: {
        type: "string",
        description: "المؤثر",
        required: true,
        choices: [
          { name: "bassboost", value: "bassboost" },
          { name: "nightcore", value: "nightcore" },
          { name: "vaporwave", value: "vaporwave" },
          { name: "8D", value: "8d" },
          { name: "تعطيل", value: "off" },
        ],
      },
    },
    async run(ctx) {
      const guildId = guildOf(ctx);
      const name = wordIn(FILTER_WORDS, ctx.args.name);
      if (!name) {
        throw new UserError(
          "أدخل `bassboost` (أو `bas`) أو `nightcore` أو `vaporwave` أو `8d` أو `wyłącz` (`off`).",
        );
      }
      // Refused here already, so the answer stays private; checked again in the chain.
      await requireControl(guildId, ctx.user.id);
      await ctx.defer();
      await oneAtATime(guildId, async () => {
        await requireControl(guildId, ctx.user.id);
        await player.setFilter(guildId, name);
      });
      redrawPanel(guildId);
      await ctx.reply(
        name === "off" ? "تم تعطيل المؤثرات." : `المؤثر: **${FILTER_LABELS[name]}**.`,
      );
    },
  });

  /** The place in `/queue` (1-based) as an index into the upcoming tracks, checked against the queue. */
  function queueIndexOf(state: PlayerState, place: number): number {
    if (state.upcoming.length === 0) throw new UserError(EMPTY_QUEUE);
    if (!Number.isInteger(place) || place < 1 || place > state.upcoming.length) {
      throw new UserError(
        `لا يوجد مقطع في الموضع ${place}. في قائمة الانتظار ${state.upcoming.length} ${tracksWord(state.upcoming.length)}.`,
      );
    }
    return place - 1;
  }

  const placeOption = {
    place: {
      type: "integer",
      description: "الموضع في قائمة الانتظار (كما في /queue)",
      required: true,
      minValue: 1,
    },
  } as const;

  const remove = defineCommand({
    name: "remove",
    description: "يحذف مقطعًا من قائمة الانتظار",
    options: placeOption,
    async run(ctx) {
      const guildId = guildOf(ctx);
      const removed = await oneAtATime(guildId, async () => {
        const state = await requireControl(guildId, ctx.user.id);
        const index = queueIndexOf(state, ctx.args.place);
        const wanted = state.upcoming[index];
        if (!wanted) throw new UserError(queueChanged);
        const taken = await player.remove(guildId, index, wanted.id);
        if (!taken) throw new UserError(queueChanged);
        return taken;
      });
      redrawPanel(guildId);
      await ctx.reply(`تم الحذف من قائمة الانتظار: **${escapeMarkdown(removed.title)}**.`);
    },
  });

  const jump = defineCommand({
    name: "jump",
    description: "ينتقل إلى مقطع في القائمة متجاوزًا المقاطع السابقة",
    options: placeOption,
    async run(ctx) {
      const guildId = guildOf(ctx);
      const target = await oneAtATime(guildId, async () => {
        const state = await requireControl(guildId, ctx.user.id);
        const index = queueIndexOf(state, ctx.args.place);
        const wanted = state.upcoming[index];
        if (!wanted || !(await player.jump(guildId, index, wanted.id))) {
          throw new UserError(queueChanged);
        }
        return wanted;
      });
      await ctx.reply(`تم الانتقال إلى: **${escapeMarkdown(target.title)}**.`);
    },
  });

  const back = defineCommand({
    name: "back",
    description: "يعود إلى المقطع السابق",
    async run(ctx) {
      const guildId = guildOf(ctx);
      const previous = await oneAtATime(guildId, async () => {
        await requireControl(guildId, ctx.user.id);
        return player.previous(guildId);
      });
      if (previous === "none") throw new UserError("لا يوجد مقطع سابق.");
      if (previous === "changed") throw new UserError(queueChanged);
      await ctx.reply(`العودة إلى: **${escapeMarkdown(previous.title)}**.`);
    },
  });

  const clear = defineCommand({
    name: "clear",
    description: "يمسح قائمة الانتظار ويواصل المقطع الحالي تشغيله",
    async run(ctx) {
      const guildId = guildOf(ctx);
      const count = await oneAtATime(guildId, async () => {
        const state = await requireControl(guildId, ctx.user.id);
        if (state.upcoming.length === 0) throw new UserError(EMPTY_QUEUE);
        await player.clear(guildId);
        return state.upcoming.length;
      });
      redrawPanel(guildId);
      await ctx.reply(`تم مسح قائمة الانتظار (${count} ${tracksWord(count)}).`);
    },
  });

  const save = defineCommand({
    name: "save",
    description: "يرسل لك المقطع الحالي في رسالة خاصة",
    aliases: ["sv"],
    async run(ctx) {
      // Like /queue and /nowplaying: anyone in the server may save what plays, in voice or not.
      const current = player.state(guildOf(ctx))?.current;
      if (!current) throw new UserError(NOTHING_PLAYING);
      const link = httpUrl(current.uri);
      const delivered = await directMessages.send(ctx.user.id, {
        content: [
          `**${escapeMarkdown(current.title)}**`,
          `**المؤلف:** ${escapeMarkdown(current.author)}`,
          link ? `<${link}>` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      await ctx.reply({
        content: delivered
          ? "أرسلت لك هذا المقطع في رسالة خاصة."
          : "تعذّر إرسال رسالة خاصة لك. تحقّق من تفعيل الرسائل الخاصة لأعضاء الخادم.",
        ephemeral: true,
      });
    },
  });

  return {
    name: MODULE,
    commands: [
      play,
      search,
      queue,
      skip,
      stop,
      pause,
      resume,
      nowPlaying,
      loop,
      shuffle,
      seek,
      volume,
      filter,
      remove,
      jump,
      back,
      clear,
      save,
    ],
    events: [voiceChange, guildGone],
    components: [
      pauseButton,
      skipButton,
      stopButton,
      queueButton,
      loopButton,
      shuffleButton,
      pick,
      queuePages.button,
    ],
    async dispose() {
      unsubscribe();
      for (const cancel of idleTimers.values()) cancel();
      idleTimers.clear();
      for (const { cancel } of failedBursts.values()) cancel();
      failedBursts.clear();
      // A panel left behind after shutdown would only offer buttons that answer "nothing is playing".
      await Promise.all(
        [...posted.keys()].map((guildId) => inOrder(guildId, () => removePanel(guildId))),
      );
    },
  };
}
