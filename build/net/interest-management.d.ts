export interface Located {
    x: number;
    y: number;
}
export interface InterestManagementApi {
    near<T extends Located>(origin: Located, entities: Iterable<T>, radius: number): T[];
    inRect<T extends Located>(entities: Iterable<T>, rect: {
        x: number;
        y: number;
        w: number;
        h: number;
    }): T[];
}
export declare function createInterestManagement(): InterestManagementApi;
