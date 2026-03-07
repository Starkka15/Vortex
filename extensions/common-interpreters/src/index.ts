import * as path from "path";
import * as process from "process";
import { log, types, util } from "vortex-api";
import * as which from "which";
import PromiseBB from "bluebird";

function exeExtension(): string {
  return process.platform === "win32" ? ".exe" : "";
}

function findJava(): string {
  if (process.env.JAVA_HOME === undefined) {
    return undefined;
  }
  const fileName = "java" + exeExtension();
  // TODO: A bit too simplistic, check the registry on windows
  return path.join(process.env.JAVA_HOME, "bin", fileName);
}

function findPython(): string {
  try {
    return which.sync("python");
  } catch (err) {
    log("info", "python not found", err.message);
    return undefined;
  }
}

const javaPath: string = findJava();
const pythonPath: string = findPython();

function init(context: types.IExtensionContext): boolean {
  context.registerInterpreter(".jar", (input: types.IRunParameters) => {
    if (javaPath === undefined) {
      throw new (util as any).MissingInterpreter(
        "Java isn't installed",
        "https://www.java.com/de/download/",
      );
    }
    return {
      executable: javaPath,
      args: ["-jar", input.executable].concat(input.args),
      options: input.options,
    };
  });

  context.registerInterpreter(".vbs", (input: types.IRunParameters) => {
    return {
      executable: path.join(process.env.windir, "system32", "cscript.exe"),
      args: [input.executable].concat(input.args),
      options: input.options,
    };
  });

  context.registerInterpreter(".py", (input: types.IRunParameters) => {
    if (pythonPath === undefined) {
      throw new (util as any).MissingInterpreter(
        "Python isn't installed",
        "https://www.python.org/downloads/",
      );
    }
    return {
      executable: pythonPath,
      args: [input.executable].concat(input.args),
      options: input.options,
    };
  });

  if (process.platform === "win32") {
    context.registerInterpreter(".cmd", (input: types.IRunParameters) => {
      return {
        executable: "cmd.exe",
        args: ["/K", `"${input.executable}"`].concat(input.args),
        options: input.options,
      };
    });

    context.registerInterpreter(".bat", (input: types.IRunParameters) => {
      return {
        executable: "cmd.exe",
        args: ["/K", `"${input.executable}"`].concat(input.args),
        options: {
          ...input.options,
          shell: true,
        },
      };
    });
  }

  // On Linux, block .exe launches with a clear message
  if (process.platform === "linux") {
    context.registerStartHook(
      50,
      "linux-exe-blocker",
      (input: types.IRunParameters): PromiseBB<types.IRunParameters> => {
        const ext = path.extname(input.executable).toLowerCase();
        if (ext !== ".exe") {
          return PromiseBB.resolve(input);
        }

        const toolName = path.basename(input.executable, ".exe");
        log("warn", "Blocked .exe launch on Linux", {
          executable: input.executable,
        });

        context.api.showDialog("info", "Windows Tool Not Supported", {
          text:
            `"${toolName}" is a Windows executable (.exe) and cannot run natively on Linux.\n\n`
            + `This is a known limitation of the Linux port. `
            + `Native Linux alternatives for mod tools are being investigated.\n\n`
            + `In the meantime, you can try running this tool manually outside of Vortex `
            + `using Wine or Proton.`,
        }, [
          { label: "OK" },
        ]);

        return PromiseBB.reject(
          new (util as any).ProcessCanceled("Windows executables are not supported on Linux"),
        );
      },
    );
  }

  return true;
}

export default init;
