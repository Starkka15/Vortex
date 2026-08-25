/*
 * Worker process for libloot on non-Windows platforms.
 *
 * Mirrors node-loot's async.js: the parent owns one end of a socket, this process holds the
 * actual libloot handle, and they exchange JSON messages delimited by ￿. node-loot uses a
 * Windows named pipe; the same net API works over a unix domain socket, so the protocol and
 * framing here are deliberately identical to keep the two implementations comparable.
 *
 * Running libloot out-of-process matters for the same reason it does on Windows: its calls are
 * synchronous and sorting a large load order takes long enough to freeze the UI if done in the
 * renderer.
 */
const net = require("net");
const path = require("path");

const binding = require(path.resolve(__dirname, "libloot-nodejs.js"));

process.on("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});

const CHUNK_SIZE = 32 * 1024;
const DELIMITER = "￿";

// libloot splits its API across the game handle and its database; the parent addresses both
// through one flat set of method names, so record which object owns each.
const DATABASE_METHODS = new Set([
  "loadMasterlist",
  "loadMasterlistWithPrelude",
  "loadUserlist",
  "writeUserMetadata",
  "clearConditionCache",
  "generalMessages",
  "groups",
  "userGroups",
  "setUserGroups",
  "pluginMetadata",
  "pluginUserMetadata",
  "setPluginUserMetadata",
  "discardPluginUserMetadata",
  "discardAllUserMetadata",
]);

const client = net.connect(process.argv[2], () => {
  let game;
  let database;
  let dataBuffer = "";

  function send(args) {
    const message = JSON.stringify(args) + DELIMITER;
    for (let i = 0; i < message.length; i += CHUNK_SIZE) {
      client.write(message.slice(i, i + CHUNK_SIZE));
    }
  }

  function handleEvent(event) {
    let result;
    try {
      if (event.type === "init") {
        const [gameType, gamePath, localPath] = event.args;
        game = new binding.Game(gameType, gamePath, localPath);
        database = game.database();
      } else if (event.type === "terminate") {
        send({});
        process.exit(0);
      } else if (DATABASE_METHODS.has(event.type)) {
        result = database[event.type](...event.args);
      } else {
        result = game[event.type](...event.args);
      }
      send({ result });
    } catch (error) {
      send({ error: error.message });
    }
  }

  client.on("data", (buffer) => {
    dataBuffer += buffer.toString();
    const messages = dataBuffer.split(DELIMITER);
    if (!dataBuffer.endsWith(DELIMITER)) {
      dataBuffer = messages.pop();
    } else {
      dataBuffer = "";
    }
    for (const msg of messages) {
      if (msg.length > 0) {
        handleEvent(JSON.parse(msg));
      }
    }
  });

  // signal readiness, exactly as node-loot's worker does
  send({ result: null });
});
