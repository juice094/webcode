import {
  clearApprovedRules,
  listApprovedRules,
  pruneRuleTimestamps,
  removeApprovedRule,
  rulesMetaStorageKey,
  rulesStorageKey,
  withRuleTimestamps,
} from "../src/approved_rules";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function main(): void {
  assert(rulesStorageKey("ws") === "allowed_tools_ws", "rules key drifted");
  assert(rulesMetaStorageKey("ws") === "allowed_tools_meta_ws", "meta key drifted");

  assert(listApprovedRules(undefined, undefined).length === 0, "empty storage should list nothing");
  assert(listApprovedRules([], {}).length === 0, "empty array should list nothing");

  const mixed = [
    "tool:read_file",
    "command-exact:execute_command:.:default:git status",
    "command-executable:run_in_terminal:.:pnpm",
    "command:execute_command:.:legacy:git pull",
  ];
  const meta = {
    "tool:read_file": 1000,
    "command-executable:run_in_terminal:.:pnpm": 3000,
  };
  const listed = listApprovedRules(mixed, meta);
  assert(listed.length === 4, "every stored rule should be listed");
  assert(
    listed.some(entry => entry.rule === "command-exact:execute_command:.:legacy:git pull"),
    "legacy command rules should be upgraded and kept"
  );
  assert(
    listed[0].rule === "command-executable:run_in_terminal:.:pnpm" && listed[0].createdAt === 3000,
    "newest timestamped rule should sort first"
  );
  assert(
    listed[listed.length - 1].createdAt === null,
    "rules without a timestamp should sort last"
  );

  const remaining = removeApprovedRule(mixed, "tool:read_file");
  assert(remaining.length === 3, "removing one rule should keep the rest");
  assert(!remaining.includes("tool:read_file"), "removed rule still present");
  assert(
    remaining.filter(rule => rule.startsWith("command-")).length === 3,
    "command rules should survive a tool rule removal"
  );
  assert(
    removeApprovedRule(remaining, "tool:read_file").length === 3,
    "removing a missing rule must be a no-op"
  );

  const prunedMeta = pruneRuleTimestamps(meta, remaining);
  assert(prunedMeta["tool:read_file"] === undefined, "removed rule timestamp should be dropped");
  assert(
    prunedMeta["command-executable:run_in_terminal:.:pnpm"] === 3000,
    "surviving timestamps must be preserved"
  );

  assert(clearApprovedRules().length === 0, "clearing should return an empty rule list");

  const stamped = withRuleTimestamps(meta, remaining, 9000);
  assert(
    stamped["command-executable:run_in_terminal:.:pnpm"] === 3000,
    "an existing timestamp must not be overwritten"
  );
  assert(
    stamped["command-exact:execute_command:.:legacy:git pull"] === 9000,
    "a new rule should receive the current timestamp"
  );
  assert(Object.keys(stamped).length === 3, "timestamps should cover exactly the live rules");

  process.stdout.write("OK approved rules list, revoke, clear and timestamps behave");
  process.stdout.write(String.fromCharCode(10));
}

main();
