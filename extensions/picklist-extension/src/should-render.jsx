export default function shouldRender({ data }) {
  // Only show when at least one order is selected
  return data.selected && data.selected.length > 0;
}
