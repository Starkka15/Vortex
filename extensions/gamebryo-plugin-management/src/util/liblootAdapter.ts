import { fork } from "child_process";
import type { ChildProcess } from "child_process";
import * as net from "net";
import * as os from "os";
import * as path from "path";

/**
 * Non-Windows implementation of the `LootAsync` interface that `loot` (node-loot) provides,
 * backed by libloot's own Node binding.
 *
 * node-loot links libloot.dll and only builds on Windows, which is why this extension used to
 * be skipped entirely elsewhere and Bethesda plugin management simply did not exist on Linux.
 * libloot was rewritten in Rust and ships a napi binding that targets Linux, so the capability
 * exists -- it just presents a synchronous, in-process API.
 *
 * Sorting a large load order takes long enough that running it in the renderer would freeze the
 * UI, which is exactly why node-loot runs out-of-process on Windows. This does the same: a
 * forked worker owns the libloot handle and the two ends exchange the same ￿-delimited JSON
 * messages node-loot uses, over a unix domain socket rather than a named pipe.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Callback<T> = (err: Error | null, result?: T) => void;

interface IPending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

const DELIMITER = "￿";
const CHUNK_SIZE = 32 * 1024;

/** libloot's GameType enum. It is a TS `const enum`, so it does not exist at runtime. */
const GAME_TYPE = {
  oblivion: 0,
  skyrim: 1,
  fallout3: 2,
  falloutnv: 3,
  fallout4: 4,
  skyrimse: 5,
  fallout4vr: 6,
  skyrimvr: 7,
  morrowind: 8,
  starfield: 9,
  openmw: 10,
  oblivionremastered: 11,
} as const;

/**
 * libloot's MergeMode / EvalMode enums, also `const enum`s and so absent at runtime.
 * node-loot always merged user metadata and evaluated conditions, so match that.
 */
const WITH_USER_METADATA = 1;
const EVALUATE_CONDITIONS = 1;

function toGameType(gameId: string): number {
  const gameType = GAME_TYPE[gameId.toLowerCase() as keyof typeof GAME_TYPE];
  if (gameType === undefined) {
    throw new Error(`libloot does not support the game "${gameId}"`);
  }
  return gameType;
}

export class LootAsync {
  public static create(
    gameId: string,
    gamePath: string,
    gameLocalPath: string,
    language: string,
    logCallback: (level: number, message: string) => void,
    onFork: unknown,
    callback: Callback<LootAsync>,
  ): void {
    let instance: LootAsync;
    try {
      instance = new LootAsync(logCallback);
    } catch (error) {
      callback(error instanceof Error ? error : new Error("failed to start libloot worker"));
      return;
    }

    instance
      .connect()
      .then(() => instance.invoke("init", [toGameType(gameId), gamePath, gameLocalPath]))
      .then(() => callback(null, instance))
      .catch((error: Error) => {
        instance.close();
        callback(error);
      });
  }

  private mSocketPath: string;
  private mServer: net.Server;
  private mWorker: ChildProcess;
  private mConnection: net.Socket;
  private mBuffer = "";
  private mQueue: IPending[] = [];
  private mClosed = false;
  private mLogCallback: (level: number, message: string) => void;

  private constructor(logCallback: (level: number, message: string) => void) {
    this.mLogCallback = logCallback;
    // Short path: unix socket paths are limited to ~108 bytes.
    this.mSocketPath = path.join(os.tmpdir(), `vtx-loot-${process.pid}-${Date.now()}.sock`);
  }

  public isClosed(): boolean {
    return this.mClosed;
  }

  public close(): void {
    if (this.mClosed) return;
    this.mClosed = true;
    try {
      this.mConnection?.end();
      this.mWorker?.kill();
      this.mServer?.close();
    } catch {
      // Tearing down a worker that has already gone is not an error worth surfacing.
    }
    // Failing to remove the socket file leaves nothing worse than a stale entry in tmp.
    void import("fs").then((fsMod) => {
      try {
        fsMod.unlinkSync(this.mSocketPath);
      } catch {
        /* already gone */
      }
    });
  }

  public sortPlugins(pluginNames: string[], cb: Callback<string[]>): void {
    this.call("sortPlugins", [pluginNames], cb);
  }

  public loadPlugins(pluginPaths: string[], headersOnly: boolean, cb: Callback<void>): void {
    this.call(headersOnly ? "loadPluginHeaders" : "loadPlugins", [pluginPaths], cb);
  }

  public loadCurrentLoadOrderState(cb: Callback<void>): void {
    this.call("loadCurrentLoadOrderState", [], cb);
  }

  public getPlugin(pluginName: string, cb: Callback<any>): void {
    this.call("plugin", [pluginName], cb);
  }

  public getPluginMetadata(pluginName: string, cb: Callback<any>): void {
    this.call("pluginMetadata", [pluginName, WITH_USER_METADATA, EVALUATE_CONDITIONS], cb);
  }

  public clearConditionCache(cb: Callback<void>): void {
    this.call("clearConditionCache", [], cb);
  }

  public loadLists(
    masterlistPath: string,
    userlistPath: string,
    preludePath: string,
    cb: Callback<void>,
  ): void {
    const load = preludePath
      ? this.invoke("loadMasterlistWithPrelude", [masterlistPath, preludePath])
      : this.invoke("loadMasterlist", [masterlistPath]);

    load
      .then(() => (userlistPath ? this.invoke("loadUserlist", [userlistPath]) : undefined))
      .then(() => cb(null))
      .catch((err: Error) => cb(err));
  }

  public getGeneralMessages(cb: Callback<any[]>): void {
    this.call("generalMessages", [WITH_USER_METADATA, EVALUATE_CONDITIONS], cb);
  }

  public getGroups(cb: Callback<any[]>): void {
    this.call("groups", [WITH_USER_METADATA], cb);
  }

  public getUserGroups(cb: Callback<any[]>): void {
    this.call("userGroups", [], cb);
  }

  public setUserGroups(groups: any[], cb: Callback<void>): void {
    this.call("setUserGroups", [groups], cb);
  }

  public getPluginUserMetadata(pluginName: string, cb: Callback<any>): void {
    this.call("pluginUserMetadata", [pluginName, EVALUATE_CONDITIONS], cb);
  }

  public setPluginUserMetadata(metadata: any, cb: Callback<void>): void {
    this.call("setPluginUserMetadata", [metadata], cb);
  }

  public writeUserMetadata(userlistPath: string, cb: Callback<void>): void {
    this.call("writeUserMetadata", [userlistPath, { truncate: true }], cb);
  }

  /** Start the worker and wait for the readiness message it sends once connected. */
  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.mServer = net.createServer((connection) => {
        this.mConnection = connection;
        connection.on("data", (data) => this.onData(data));
        connection.on("error", (err) => this.failAll(err));
      });

      this.mServer.on("error", reject);
      this.mServer.listen(this.mSocketPath, () => {
        this.mWorker = fork(path.resolve(__dirname, "liblootWorker.js"), [this.mSocketPath], {
          silent: false,
        });
        this.mWorker.on("error", reject);
        this.mWorker.on("exit", (code) => {
          if (!this.mClosed) {
            this.failAll(new Error(`libloot worker exited unexpectedly (code ${code})`));
          }
        });
        // The worker's first message is its readiness signal.
        this.mQueue.push({ resolve: () => resolve(), reject });
      });
    });
  }

  private onData(data: Buffer): void {
    this.mBuffer += data.toString();
    const messages = this.mBuffer.split(DELIMITER);
    this.mBuffer = this.mBuffer.endsWith(DELIMITER) ? "" : messages.pop();

    for (const message of messages) {
      if (message.length === 0) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(message);
      } catch {
        continue;
      }

      // Log lines are unsolicited; they must not consume a queued reply.
      if (parsed.log !== undefined) {
        this.mLogCallback?.(parsed.log.level, parsed.log.message);
        continue;
      }

      const pending = this.mQueue.shift();
      if (pending === undefined) continue;
      if (parsed.error !== undefined) {
        pending.reject(new Error(parsed.error));
      } else {
        pending.resolve(parsed.result);
      }
    }
  }

  private failAll(err: Error): void {
    const queued = this.mQueue.splice(0, this.mQueue.length);
    for (const pending of queued) {
      pending.reject(err);
    }
  }

  private invoke(type: string, args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.mClosed || this.mConnection === undefined) {
        reject(new Error("libloot worker is not running"));
        return;
      }
      this.mQueue.push({ resolve, reject });
      const message = JSON.stringify({ type, args }) + DELIMITER;
      for (let i = 0; i < message.length; i += CHUNK_SIZE) {
        this.mConnection.write(message.slice(i, i + CHUNK_SIZE));
      }
    });
  }

  private call<T>(type: string, args: any[], cb: Callback<T>): void {
    this.invoke(type, args).then(
      (result: T) => cb(null, result),
      (err: Error) => cb(err),
    );
  }
}
