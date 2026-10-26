import { BRIDGE_MIN_GATEWAY_VERSION } from "@webcode/shared";
import { isGatewayVersionCompatible } from "../src/background/connection";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function main(): void {
  if (!BRIDGE_MIN_GATEWAY_VERSION) {
    assert(
      isGatewayVersionCompatible("1.5.0", "1.5.0"),
      "identical versions should match under legacy exact match"
    );
    assert(
      !isGatewayVersionCompatible("1.4.1", "1.5.0"),
      "skewed versions should fail under legacy exact match"
    );
    return;
  }

  assert(
    isGatewayVersionCompatible("1.5.0", "1.4.1"),
    "newer gateway should be accepted for an older browser bridge"
  );
  assert(
    isGatewayVersionCompatible("1.4.1", "1.5.0"),
    "older gateway above the minimum should be accepted for a newer browser bridge"
  );
  assert(
    !isGatewayVersionCompatible("0.9.0", "1.5.0"),
    "gateway below the minimum should be rejected"
  );
}

main();
