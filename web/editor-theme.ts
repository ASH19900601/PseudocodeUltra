import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Keep CodeMirror's dark-theme facet in sync with the surrounding application.
// Its selection, completion, search and lint extensions also consult this facet.
export function editorAppearance(dark: boolean): Extension {
  const palette = dark
    ? {
        background: "#141625",
        foreground: "#e6e8ef",
        gutter: "#929bb1",
        active: "#1c2033",
        selection: "#33436a",
        popup: "#20243a",
        border: "#383e57",
        accent: "#79a8ff",
        keyword: "#83b4ff",
        string: "#c99cff",
        number: "#a5d6ff",
        type: "#f4bd7a",
        comment: "#929bb1",
        invalid: "#ff9caa",
      }
    : {
        background: "#fbfcfd",
        foreground: "#253446",
        gutter: "#64748b",
        active: "#edf2f9",
        selection: "#d9e5fb",
        popup: "#ffffff",
        border: "#d7deea",
        accent: "#295dcc",
        keyword: "#7042a6",
        string: "#356b2c",
        number: "#97531d",
        type: "#07677a",
        comment: "#657184",
        invalid: "#b52f49",
      };
  return [
    EditorView.theme(
      {
        "&": {
          color: palette.foreground,
          backgroundColor: palette.background,
        },
        ".cm-content": { caretColor: palette.foreground },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: palette.foreground,
        },
        ".cm-gutters": {
          color: palette.gutter,
          backgroundColor: palette.background,
          borderColor: palette.border,
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: palette.active,
        },
        ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
          { backgroundColor: palette.selection },
        ".cm-content ::selection": { backgroundColor: palette.selection },
        ".cm-tooltip, .cm-tooltip.cm-tooltip-autocomplete, .cm-tooltip.cm-completionInfo":
          {
            backgroundColor: palette.popup,
            color: palette.foreground,
            border: `1px solid ${palette.border}`,
            borderRadius: "4px",
            boxShadow: dark ? "0 8px 24px #00000050" : "0 8px 24px #25344618",
          },
        ".cm-tooltip-autocomplete ul li[aria-selected]": {
          backgroundColor: palette.selection,
          color: palette.foreground,
        },
        ".cm-completionDetail, .cm-completionMatchedText": {
          color: palette.accent,
        },
        ".cm-panels": {
          backgroundColor: palette.popup,
          color: palette.foreground,
        },
        ".cm-panels-top, .cm-panels-bottom": {
          borderColor: palette.border,
        },
        ".cm-search input, .cm-search button": {
          background: palette.background,
          color: palette.foreground,
          borderColor: palette.border,
        },
        ".cm-searchMatch": {
          backgroundColor: dark ? "#795b2c80" : "#ffda7a80",
          outline: `1px solid ${dark ? "#b98c45" : "#c49a42"}`,
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
          backgroundColor: palette.selection,
        },
        ".cm-foldPlaceholder": {
          backgroundColor: palette.popup,
          color: palette.gutter,
          borderColor: palette.border,
        },
        ".cm-matchingBracket": {
          backgroundColor: palette.selection,
          color: palette.foreground,
        },
        ".cm-nonmatchingBracket": { color: palette.invalid },
        ".cm-tooltip-arrow:before": { borderTopColor: palette.border },
        ".cm-tooltip-arrow:after": { borderTopColor: palette.popup },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.keyword, color: palette.keyword },
        { tag: [tags.atom, tags.bool, tags.number], color: palette.number },
        {
          tag: [tags.string, tags.character, tags.regexp],
          color: palette.string,
        },
        {
          tag: [tags.typeName, tags.className, tags.namespace],
          color: palette.type,
        },
        {
          tag: [
            tags.standard(tags.variableName),
            tags.function(tags.variableName),
          ],
          color: palette.type,
        },
        { tag: tags.comment, color: palette.comment, fontStyle: "italic" },
        {
          tag: [tags.meta, tags.operator, tags.punctuation],
          color: palette.foreground,
        },
        {
          tag: tags.invalid,
          color: palette.invalid,
          textDecoration: "underline wavy",
        },
      ]),
    ),
  ];
}
