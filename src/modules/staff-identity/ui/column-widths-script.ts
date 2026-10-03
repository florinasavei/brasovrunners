import {
  ACTIONS_COLUMN,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  storageKey,
  TABLE_ID_PATTERN,
} from "@/modules/staff-identity/domain/column-widths";

/**
 * The few lines that put a resized table at its stored widths before the first paint (§NNN).
 *
 * `ColumnWidths` lays the table out in a layout effect, which runs only once the page hydrates —
 * after the server's HTML has already painted with the automatic layout, so a column stored 120 px
 * wider was drawn automatic first and then jumped. This script runs where the parser meets it,
 * right after `</table>`: it reads `br.table.<id>.widths`, measures the columns nobody dragged in
 * the automatic layout (as `layOut` does) and, when a stored width belongs to a column on screen,
 * appends one `<style data-column-widths="<id>">` to `<head>` with the same fixed layout — at once,
 * or in the first frame the table is displayed (`WAIT_FRAMES`).
 *
 * A `<style>` element and not attributes: the table, its `<col>`s and their `style` belong to
 * React, and an attribute written before hydration is a hydration mismatch; `<head>` tolerates an
 * element a script added. The islands remove it the moment they lay the table out themselves
 * (`dropEarlyStyle`), so after hydration they are the one source of the widths. With JavaScript
 * off nothing runs, nothing was stored, and the table is the automatic one.
 *
 * Static text but for the table's id, which `TABLE_ID_PATTERN` allows only lowercase letters,
 * digits and hyphens into — checked again here, because it is written into a script. No row and
 * nothing about a person is in it.
 */
/**
 * How many frames the script waits for its table to be displayed. A list streamed in behind a
 * `loading.tsx` boundary is parsed inside a hidden template and revealed by React a moment later,
 * so the script, run at parse, meets a table that measures nothing; it looks again each frame —
 * an animation frame runs after the reveal and before its paint — for about five seconds, and
 * stops at once when hydration removes the script (the islands own the widths then) or when the
 * table never shows (the phone layout).
 */
const WAIT_FRAMES = 300;

export function earlyWidthsScript(tableId: string): string {
  if (!TABLE_ID_PATTERN.test(tableId)) throw new Error(`earlyWidthsScript: tableId "${tableId}" is not lowercase-hyphenated`);
  const [prefix, suffix] = storageKey("\u0000").split("\u0000");
  return [
    "(function f(i,n,me){try{",
    "var q='table[data-table-id=\"'+i+'\"]',t=document.querySelector(q),",
    "w=JSON.parse(localStorage.getItem(" + JSON.stringify(prefix) + "+i+" + JSON.stringify(suffix) + ")||'null');",
    "if(!t||!w||typeof w!=='object'||!me||!me.isConnected)return;",
    "if(t.offsetParent===null){if(n<" + WAIT_FRAMES + ")requestAnimationFrame(function(){f(i,n+1,me);});return;}",
    "var k=/^[A-Za-z0-9_-]{1,80}$/,css='',sum=0,hit=false;",
    "t.querySelectorAll(':scope>colgroup>col[data-column]').forEach(function(c){",
    "var key=c.getAttribute('data-column'),h=k.test(key)&&t.querySelector(':scope>thead th[data-column=\"'+key+'\"]');",
    "if(!h||getComputedStyle(h).display==='none')return;",
    "var s=key!==" + JSON.stringify(ACTIONS_COLUMN) + "&&typeof w[key]==='number'&&isFinite(w[key]);",
    "var px=s?Math.min(" + MAX_COLUMN_WIDTH + ",Math.max(" + MIN_COLUMN_WIDTH + ",Math.round(w[key]))):Math.round(h.getBoundingClientRect().width);",
    "hit=hit||s;sum+=px;css+=q+'>colgroup>col[data-column=\"'+key+'\"]{width:'+px+'px}';});",
    "if(!hit)return;",
    "var e=document.createElement('style');e.setAttribute('data-column-widths',i);",
    "e.textContent=q+'{table-layout:fixed;width:'+sum+'px}'+q+'>thead>tr>th{white-space:normal}'",
    "+q+'>tbody>tr>td{overflow:hidden;overflow-wrap:anywhere}'+css;",
    "document.head.appendChild(e);}catch(x){}})(" + JSON.stringify(tableId) + ",0,document.currentScript);",
  ].join("");
}
