/** Normalized board coordinates, independent of viewport size. */
export interface Point { x: number; y: number }
/** A committed, immutable drawing gesture. */
export interface Stroke { id: string; author: string; color: string; points: Point[] }
/** A server-attributed room message. */
export interface ChatMessage { id: string; author: string; text: string; at: string }
/** Bounded durable demo state; presence and cursors are intentionally ephemeral. */
export interface RoomContents { strokes: Stroke[]; messages: ChatMessage[] }
/** One connected tab, not an assertion that an account is globally online. */
export interface Participant { id: string; name: string; color: string; userId: string | null; cursor: Point | null }
