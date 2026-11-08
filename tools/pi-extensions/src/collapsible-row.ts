// A message row that opens and shuts on a click or ctrl+o, like a quiet tool row.
import { Box, MouseRegion } from "@earendil-works/pi-tui";

/**
 * Rows the user clicked open or shut, with the ctrl+o state at that time. pi rebuilds the row on ctrl+o and on
 * resize; a click survives a resize, and ctrl+o overrides it, as it does for tool rows.
 */
const clicks = new WeakMap<object, { open: boolean; expanded: boolean }>();

type RowOptions = {
  /** The message being rendered; it keys the click state across rebuilds. */
  message: object;
  /** pi's ctrl+o state. */
  expanded: boolean;
  /** pi's outputPad setting; tool rows pad by it. */
  outputPad: number;
  background: (text: string) => string;
  /** Adds the row's content to `box`, open or shut. Called again after each click. */
  fill: (box: Box, open: boolean) => void;
};

export function collapsibleRow({ message, expanded, outputPad, background, fill }: RowOptions) {
  const box = new Box(outputPad, 1, background);
  // ctrl+o was pressed since the click.
  if (clicks.get(message)?.expanded !== expanded) clicks.delete(message);
  const isOpen = () => clicks.get(message)?.open ?? expanded;
  const refill = () => {
    box.clear();
    fill(box, isOpen());
  };
  refill();
  return new MouseRegion(box, (event) => {
    if (event.type !== "click" || event.button !== "left") return undefined;
    clicks.set(message, { open: !isOpen(), expanded });
    refill();
    return { handled: true };
  });
}
