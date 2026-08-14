/** Sender id reserved for the relay's own control frames. */
export declare const CONTROL = "";
/** Membership and host notices, identical for both topologies. */
export type RoomNotice = {
    type: "welcome";
    id: string;
    host: string | null;
    peers: string[];
} | {
    type: "peer-join";
    id: string;
} | {
    type: "peer-leave";
    id: string;
} | {
    type: "host";
    id: string | null;
};
export declare const encodeJson: (value: unknown) => Uint8Array;
export declare const decodeJson: (bytes: Uint8Array) => unknown;
export declare function frame(id: string, tag: string, payload: Uint8Array): Uint8Array;
export interface Frame {
    from: string;
    tag: string;
    payload: Uint8Array;
}
export declare function unframe(bytes: Uint8Array): Frame | null;
/** Build a relay→client control frame. */
export declare const controlFrame: (notice: RoomNotice) => Uint8Array;
