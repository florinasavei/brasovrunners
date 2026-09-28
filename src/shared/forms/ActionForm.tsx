import type { ComponentProps } from "react";
import { actionKeyOf } from "./action-key";
import ActionFormIsland from "./ActionFormIsland";

export type { ActionFormAction, RefusalMessages } from "./ActionFormIsland";

/**
 * The backoffice's form (`ActionFormIsland`, §315, §384), rendered from a Server Component: only
 * here can the Server Action's id be read, so this stamps its key for the blocked-save fallback (§436).
 */
export default function ActionForm(props: Omit<ComponentProps<typeof ActionFormIsland>, "actionKey">) {
  return <ActionFormIsland {...props} actionKey={actionKeyOf(props.action)} />;
}
