import assert from "node:assert/strict";
import { test } from "node:test";

import { captureCommand } from "../../scripts/capture-command.mjs";

test("captured command output waits for the stdout stream to close", async () => {
  const expected = JSON.stringify({ abi: 42, payload: "x".repeat(65_536) });
  const descendantSource = `
    process.on("disconnect", () => {
      process.stdout.write(${JSON.stringify(expected)});
    });
  `;
  const producerSource = `
    import { spawn } from "node:child_process";

    const child = spawn(process.execPath, ["--eval", ${JSON.stringify(descendantSource)}], {
      stdio: ["ignore", 1, 2, "ipc"],
    });
    child.unref();
    child.channel?.unref();
  `;

  const output = await captureCommand(process.execPath, [
    "--input-type=module",
    "--eval",
    producerSource,
  ]);

  assert.deepEqual(JSON.parse(output.toString("utf8")), JSON.parse(expected));
});
