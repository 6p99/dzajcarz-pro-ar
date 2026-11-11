import type { ButtonSpec, Embed } from "@dzajcarz/core";
import { escapeMarkdown, formatDuration, httpUrl, progressLine, truncate } from "./format.ts";
import type { LoopMode, MusicFilter, MusicTrack, PanelMessage, PlayerState } from "./ports.ts";

export const PANEL_COLOR = 0x1db954;
/** Discord's embed title limit. */
const MAX_TITLE = 256;

export interface PanelButtons {
  pause: (paused: boolean) => ButtonSpec;
  skip: ButtonSpec;
  stop: ButtonSpec;
  queue: ButtonSpec;
  loop: (mode: LoopMode) => ButtonSpec;
  shuffle: ButtonSpec;
}

export const LOOP_LABELS: Record<LoopMode, string> = {
  off: "معطّل",
  track: "مقطع",
  queue: "قائمة الانتظار",
};

export const FILTER_LABELS: Record<MusicFilter, string> = {
  off: "لا يوجد",
  bassboost: "bassboost",
  nightcore: "nightcore",
  vaporwave: "vaporwave",
  "8d": "8D",
};

/** The loop, volume and filter settings part of the footer. */
export function settingsLine(state: Pick<PlayerState, "loop" | "volume" | "filter">): string {
  return `التكرار: ${LOOP_LABELS[state.loop]} · مستوى الصوت: ${state.volume}% · المؤثر: ${FILTER_LABELS[state.filter]}`;
}

/** Title (linked), author, cover, progress and who added the track. */
export function trackEmbed(
  track: MusicTrack,
  positionMs: number,
  upcoming: number,
  settings: string,
): Embed {
  return {
    title: truncate(track.title, MAX_TITLE),
    url: httpUrl(track.uri),
    thumbnail: httpUrl(track.artworkUrl),
    color: PANEL_COLOR,
    description: [
      `**المؤلف:** ${escapeMarkdown(track.author)}`,
      `**أضافه:** <@${track.requesterId}>`,
      progressLine(positionMs, track.durationMs, track.isStream),
    ].join("\n"),
    footer: `${upcoming === 0 ? "قائمة الانتظار فارغة" : `في القائمة: ${upcoming}`} · ${settings}`,
  };
}

/** The now playing panel; null when nothing is playing or the bot plays its own track. */
export function panelMessage(state: PlayerState, buttons: PanelButtons): PanelMessage | null {
  if (!state.current || state.current.byBot) return null;
  return {
    embeds: [
      trackEmbed(state.current, state.positionMs, state.upcoming.length, settingsLine(state)),
    ],
    components: [
      [buttons.pause(state.paused), buttons.skip, buttons.stop, buttons.queue],
      [buttons.loop(state.loop), buttons.shuffle],
    ],
  };
}

/** One line of `/queue`: `3. [Title](link) · 3:21 · @member`. */
export function queueLine(index: number, track: MusicTrack): string {
  const title = escapeMarkdown(truncate(track.title, 60));
  const url = httpUrl(track.uri);
  const label = url ? `[${title}](${url.replaceAll(")", "%29")})` : title;
  const length = track.isStream ? "مباشر" : formatDuration(track.durationMs);
  return `\`${index}.\` ${label} · ${length} · <@${track.requesterId}>`;
}

/** Arabic display label for the number of tracks. */
export function tracksWord(count: number): string {
  return count === 1 ? "مقطع" : "مقاطع";
}
