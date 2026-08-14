import { Flowable } from "../../ui/core/index.js";
/** A horizontal tab strip. */
export interface TabsOptions extends Flowable {
    /** Stable identity enables Tab focus and arrow-key selection. */
    id?: string;
    /** Position in the keyboard tab order. */
    tabIndex?: number;
    /** Total width, split equally between the tabs. Omit to auto-size every
     *  cell to the widest label. */
    w?: number;
    /** Strip height in px. Default `theme.tabH`. */
    h?: number;
    /** Tab labels, left to right. */
    items: string[];
    /** Current tab index — pass your state in, assign the return value back. */
    active: number;
    /** Label font. Default a bold `theme.fontSize` UI font. */
    font?: string;
}
/** Draw a tab strip; returns the (possibly changed) active index:
 *
 *    tab = UI.tabs({ x, y, items: ["All", "Coop", "PvP"], active: tab }); */
export declare function tabs(opts: TabsOptions): number;
