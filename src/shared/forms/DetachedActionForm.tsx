import type { ComponentProps } from "react";
import { actionKeyOf } from "./action-key";
import DetachedActionFormIsland from "./DetachedActionFormIsland";

export { DetachedFields, DetachedForm } from "./DetachedActionFormIsland";

/**
 * A kept form whose boxes are drawn inside another form's markup (`DetachedActionFormIsland`, §NNN),
 * rendered from a Server Component: like `ActionForm.tsx`, only this wrapper runs where the Server
 * Action's id can be read, so it stamps the key a blocked save uses to find the form again (§436).
 */
export default function DetachedActionForm(props: Omit<ComponentProps<typeof DetachedActionFormIsland>, "actionKey">) {
  return <DetachedActionFormIsland {...props} actionKey={actionKeyOf(props.action)} />;
}
