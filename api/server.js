import * as fs from "node:fs/promises";
import * as path from "node:path";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { WebSocketServer } from "ws";
import * as dockerode from "dockerode";

import { default as directoryTree } from "directory-tree";
import configs from "./configs.js";
import DockerEngine from "./containers/docker_engine.js";
import DB from "./database.js";
import { nanoid } from "nanoid";

let dockerConnection;

try {
  console.info("==> Connecting to Docker Daemon");
  dockerConnection = new dockerode.default(configs.DOCKER_ENGINE_SOCKET);
  const infos = await dockerConnection.version();
  console.info("==> Docker Daemon Connection Info");
  console.info(infos);
} catch (error) {
  console.error(error);
  console.error("==> Cannot Connect to Docker Daemon!");
  console.error("==> Exiting...");
  process.exit(1);
}

const dockerEngine = new DockerEngine(dockerConnection);
const app = new Hono();

app.use("*", logger());

app.get("/", async (c) => {
  const projectId = nanoid();
  return c.redirect(`/p/${projectId}`);
});

app.get("/p/:pid", async (c) => {
  const indexPath = "index.html";
  try {
    const content = await fs.readFile(indexPath);
    return c.html(content);
  } catch (error) {
    console.error(error);
    return new Response("Error on Server", {
      status: 500,
    });
  }
});

app.post("/container/create/:pid", async (c) => {
  try {
    const projectId = c.req.param("pid");
    const container = await dockerEngine.createContainer(projectId);
    DB.set(container.id, container);
    DB.set(container.projectId, container);
    const containerCreateResponse = {
      "container-id": container.id,
      "temp-dir-path": container.tempDirPath,
      "project-id": container.projectId,
    };
    return c.json(containerCreateResponse);
  } catch (error) {
    console.error(error);
    return c.json(
      {
        msg: error.msg,
      },
      500
    );
  }
});

app.get("/version", async (c) => {
  return c.text("v0.0.1");
});

app.get("/fs/file/open/:cid/:pathenc", async (c) => {
  try {
    const cid = c.req.param("cid");
    const pathEncoded = c.req.param("pathenc");
    const filename = Buffer.from(pathEncoded, "base64")
      .toString("utf-8")
      .substring(1);
    const containerInstance = await dockerConnection
      .getContainer(cid)
      .inspect();

    const container = DB.get(containerInstance.Id);
    const filepath = `${container.tempDirPath}/${filename}`;
    const content = await fs.readFile(filepath);

    if (container.ws) {
      container.ws.send(
        JSON.stringify({
          type: "open",
          params: {
            filename,
            filepath,
            content: content.toString("utf-8"),
          },
        })
      );
    }

    return new Response("Ok");
  } catch (error) {
    console.error(error);
    return new Response("File not found", {
      status: 404,
    });
  }
});

const server = serve(
  {
    fetch: app.fetch,
    port: configs.PORT,
  },
  (info) => {
    console.log(`Listening on http://localhost:${info.port}`);
  }
);

const wss = new WebSocketServer({
  server,
});

wss.on("connection", connection);

async function connection(ws, req) {
  console.info(`WebSocket Connection opened: ${JSON.stringify(req.url)}`);
  const containerId = new URL(req.url, "http://localhost").searchParams.get(
    "cid"
  );

  const container = DB.get(containerId) || {};
  container.ws = ws;

  const tree = directoryTree(container.tempDirPath);

  ws.send(
    JSON.stringify({
      type: "fs",
      params: tree,
    })
  );

  ws.on("message", async function message(message) {
    try {
      const cmd = JSON.parse(message);
      if (cmd.type === "resize") {
        const container = dockerConnection.getContainer(containerId);
        await container.resize(cmd.params);
      }
      if (cmd.type === "write") {
        const { filename, source } = cmd.params;
        const tempDirPath = container.tempDirPath;
        const path = `${tempDirPath}/${filename}`;
        await fs.writeFile(path, source);
      }
      if (cmd.type === "writeInPath") {
        const { filepath, source } = cmd.params;
        await fs.writeFile(filepath, source);
      }
      if (cmd.type === "mkdir") {
        const { folderpath } = cmd.params;
        await fs.mkdir(folderpath, {
          recursive: true,
        });
      }
      if (cmd.type === "open") {
        const { filepath } = cmd.params;
        const content = await fs.readFile(filepath);
        const filename = path.basename(filepath);

        ws.send(
          JSON.stringify({
            type: "open",
            params: {
              filename,
              filepath,
              content: content.toString("utf-8"),
            },
          })
        );
      }
    } catch (error) {
      console.error(error);
    }
  });

  ws.on("close", async function close() {
    console.info(`WebSocket Connection closed:`);
    console.info("==> Connecting to Docker Daemon");
    try {
      const container = dockerConnection.getContainer(containerId);
      console.info("==> Removing Docker Container: ", containerId);
      await container.stop();
      // await container.remove()
    } catch (error) {
      if (error.reason === "no such container") return;
      console.error(error);
    }
  });
  ws.on("error", console.error);
}

async function handle_signals() {
  console.log("Ctrl-C was pressed");
  dockerConnection.removeContainers();
  server.close();
  wss.close();
}

process.on("SIGINT", handle_signals);
process.on("SIGTERM", handle_signals);
