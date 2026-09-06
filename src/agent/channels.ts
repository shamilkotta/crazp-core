import type { ChannelDefinition } from "@cloudflare/think";
import type { MessengerDefinition } from "@cloudflare/think/messengers";
import type { CrazpCustomChannelDefinition } from "crazp/channels";
import { isCrazpCustomChannelDefinition } from "crazp/channels";

export { isCrazpCustomChannelDefinition };

function isMessengerDefinition(value: unknown): value is MessengerDefinition {
  return (
    typeof value === "object" &&
    value != null &&
    "adapter" in value &&
    "adapterName" in value &&
    "provider" in value
  );
}

export function isChannelDefinition(
  value: unknown
): value is ChannelDefinition {
  return (
    typeof value === "object" &&
    value != null &&
    "kind" in value &&
    "ingress" in value
  );
}

export function toMessengerDefinition(
  value: ChannelDefinition | MessengerDefinition | CrazpCustomChannelDefinition
): MessengerDefinition | null {
  if (isCrazpCustomChannelDefinition(value)) return null;
  if (isMessengerDefinition(value)) return value;
  if (
    isChannelDefinition(value) &&
    value.kind === "messenger" &&
    value.ingress.transport === "webhook"
  ) {
    return value.ingress;
  }
  return null;
}
