const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseDeepLink, findDeepLinkInArgv } = require("./deeplink");

test("parses valid deep links only", () => {
  assert.equal(parseDeepLink("simhammer://sim/K3Fq9xTz2a"), "K3Fq9xTz2a");
  assert.equal(parseDeepLink("simhammer://sim/K3Fq9xTz2a/"), "K3Fq9xTz2a");
  assert.equal(parseDeepLink("SIMHAMMER://sim/K3Fq9xTz2a"), "K3Fq9xTz2a");
  assert.equal(parseDeepLink("simhammer://sim/../../x"), null);
  assert.equal(parseDeepLink("simhammer://other/K3Fq9xTz2a"), null);
  assert.equal(parseDeepLink("https://simhammer.com/sim/K3Fq9xTz2a"), null);
});

test("finds the link in cold-start and second-instance argv shapes", () => {
  assert.equal(findDeepLinkInArgv(["C:\\SimHammer\\SimHammer.exe", "simhammer://sim/K3Fq9xTz2a"]), "K3Fq9xTz2a");
  assert.equal(findDeepLinkInArgv(["electron.exe", ".", "--flag", "simhammer://sim/K3Fq9xTz2a"]), "K3Fq9xTz2a");
  assert.equal(findDeepLinkInArgv(["SimHammer.exe"]), null);
});
