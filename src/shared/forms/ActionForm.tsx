import type { ComponentProps } from "react";
import { actionKeyOf } from "./action-key";
import ActionFormIsland from "./ActionFormIsland";

export type { ActionFormAction, RefusalMessages } from "./ActionFormIsland";

/**
 * The backoffice's form (`ActionFormIsland`, §315, §384), rendered from a Server Component.
 *
 * Only this wrapper runs where the Server Action's id can be read (`actionKeyOf`, §NNN), so it
 * stamps the form with it: the key a blocked save uses to find the same form in the page's HTML
 * when the browser drew this one itself. Everything else is the island's.
 */
export default function ActionForm(props: Omit<ComponentProps<typeof ActionFormIsland>, "actionKey">) {
  return <ActionFormIsland {...props} actionKey={actionKeyOf(props.action)} />;
}
