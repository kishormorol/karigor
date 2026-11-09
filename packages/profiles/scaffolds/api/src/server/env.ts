import type { Db } from "../db/index.js";

/** What every handler can read from `c.var`: the database to use, and the key calling (once `need` has checked it). */
export type Env = { Variables: { db: Db; keyId?: string } };
