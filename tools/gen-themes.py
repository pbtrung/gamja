#!/usr/bin/env python3
"""Generate src/styles/themes.css from the color palettes below.

Each theme maps its official palette onto gamja's design tokens (see
src/styles/tokens.css). Run: python3 tools/gen-themes.py
"""

import os


def mix(color, pct, other="transparent"):
    return f"color-mix(in srgb, {color} {pct}%, {other})"


def rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def hexc(c):
    return "#" + "".join(f"{max(0, min(255, round(v))):02x}" for v in c)


def blend(fg, bg, alpha):
    """Composite fg with the given opacity over bg."""
    f, b = rgb(fg), rgb(bg)
    return hexc([f[i] * alpha + b[i] * (1 - alpha) for i in range(3)])


def luminance(h):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(h)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def ensure(color, backgrounds, scheme, minimum=4.6):
    """Lighten (dark themes) or darken (light themes) a text color until it
    reaches the minimum contrast against every background."""
    target = "#ffffff" if scheme == "dark" else "#000000"
    c = color
    for step in range(1, 41):
        if all(contrast(c, b) >= minimum for b in backgrounds):
            return c
        c = blend(target, color, step / 40)
    return c


def theme(scheme, bg, sidebar, elevated, subtle, fg, emphasis, muted, faint, border, border_strong,
          accent, accent_hover, accent_fg, danger, warning, success, info, nicks, avatar_fg=None):
    assert len(nicks) == 16
    t = {
        "color-scheme": scheme,
        "--bg": bg,
        "--bg-sidebar": sidebar,
        "--bg-elevated": elevated,
        "--bg-subtle": subtle,
        "--bg-hover": mix(fg, 6),
        "--bg-active": mix(accent, 18),
        "--fg": fg,
        "--fg-emphasis": emphasis,
        "--fg-muted": muted,
        "--fg-subtle": faint,
        "--fg-active": accent if scheme == "dark" else accent_hover,
        "--border": border,
        "--border-strong": border_strong,
        "--accent": accent,
        "--accent-hover": accent_hover,
        "--accent-fg": accent_fg,
        "--accent-soft": mix(accent, 16),
        "--focus-ring": mix(accent, 40),
        "--danger": danger,
        "--danger-fg": danger,
        "--danger-soft": mix(danger, 14),
        "--warning": warning,
        "--warning-fg": warning,
        "--warning-soft": mix(warning, 15),
        "--success": success,
        "--info-fg": info,
        "--info-soft": mix(info, 13),
        "--highlight-bg": mix(warning, 10),
        "--highlight-border": warning,
        "--mention-bg": mix(warning, 24),
        "--mention-fg": emphasis,
        "--shadow-sm": "0 1px 2px rgb(0 0 0 / 0.3)" if scheme == "dark" else "0 1px 2px rgb(0 0 0 / 0.08)",
        "--shadow-lg": "0 16px 40px rgb(0 0 0 / 0.5)" if scheme == "dark" else "0 12px 32px rgb(0 0 0 / 0.15)",
        "--backdrop": "rgb(0 0 0 / 0.6)" if scheme == "dark" else "rgb(0 0 0 / 0.35)",
        "--avatar-fg": avatar_fg or (bg if scheme == "dark" else "#ffffff"),
        "--scrollbar": mix(fg, 22),
    }
    # Text must stay readable on every background it's shown on: the page,
    # raised surfaces, and hovered or highlighted message rows
    backgrounds = [bg, elevated, subtle, blend(fg, bg, 0.06), blend(warning, bg, 0.10),
                   blend(fg, blend(warning, bg, 0.10), 0.06), sidebar]
    text_backgrounds = [bg, blend(fg, bg, 0.06), blend(warning, bg, 0.10), blend(fg, blend(warning, bg, 0.10), 0.06)]
    t["--fg"] = ensure(fg, backgrounds, scheme)
    t["--fg-muted"] = ensure(muted, backgrounds, scheme)
    t["--fg-active"] = ensure(t["--fg-active"], [blend(accent, bg, 0.18), blend(accent, sidebar, 0.18)], scheme)
    t["--accent"] = ensure(accent, text_backgrounds, scheme)
    t["--danger-fg"] = ensure(danger, backgrounds, scheme)
    t["--warning-fg"] = ensure(warning, backgrounds, scheme)
    t["--info-fg"] = ensure(info, [blend(info, bg, 0.13)] + text_backgrounds, scheme)
    t["--mention-fg"] = ensure(emphasis, [blend(warning, bg, 0.24)], scheme)
    # Buttons: text on the accent color
    if contrast(accent_fg, t["--accent"]) < 4.5:
        t["--accent-fg"] = "#ffffff" if contrast("#ffffff", t["--accent"]) > contrast("#000000", t["--accent"]) else "#000000"
    for i, c in enumerate(nicks):
        t[f"--nick-{i + 1}"] = ensure(c, text_backgrounds, scheme)
    return t


# gamja's own dark palette
gamja_dark = theme(
    "dark", bg="#16181d", sidebar="#111317", elevated="#1d2026", subtle="#22262d",
    fg="#dfe3e8", emphasis="#f5f7fa", muted="#9aa4af", faint="#6c7681",
    border="#2a2f37", border_strong="#3a414b",
    accent="#748ffc", accent_hover="#91a7ff", accent_fg="#0f1320",
    danger="#f06595", warning="#fcc419", success="#51cf66", info="#74c0fc",
    nicks=["#f6844a", "#f2694d", "#fbab4f", "#d6cb3c", "#a5d65e", "#78c871", "#5bc48d", "#6bccc7",
           "#4fc0e3", "#6fa6d6", "#9fb0e4", "#a9a5ef", "#bb8fe0", "#d98fd9", "#f067a6", "#f5667a"],
    avatar_fg="#111317",
)

# gamja's own light palette, the default
gamja_light = theme(
    "light", bg="#ffffff", sidebar="#f6f7f9", elevated="#ffffff", subtle="#f1f3f5",
    fg="#1f2328", emphasis="#0b0d10", muted="#59636e", faint="#8a939d",
    border="#e3e6ea", border_strong="#cdd2d8",
    accent="#3b5bdb", accent_hover="#2f4ac0", accent_fg="#ffffff",
    danger="#d6336c", warning="#e8a317", success="#2f9e44", info="#1c5d8c",
    nicks=["#d9540b", "#c92f0f", "#b9640a", "#807500", "#5e8a1f", "#3a8a34", "#287e52", "#117873",
           "#0077a0", "#2a6596", "#385189", "#4f4a8c", "#6a4589", "#8a3f8a", "#c0226a", "#c81f35"],
)

# https://draculatheme.com/contribute
d = dict(bg="#282a36", line="#44475a", fg="#f8f8f2", comment="#6272a4", cyan="#8be9fd", green="#50fa7b",
         orange="#ffb86c", pink="#ff79c6", purple="#bd93f9", red="#ff5555", yellow="#f1fa8c")
dracula = theme(
    "dark", bg=d["bg"], sidebar="#21222c", elevated="#2f3241", subtle="#343746",
    fg=d["fg"], emphasis="#ffffff", muted="#a4a9c4", faint=d["comment"],
    border="#383a4a", border_strong=d["line"],
    accent=d["purple"], accent_hover="#cfb0fb", accent_fg=d["bg"],
    danger=d["red"], warning=d["yellow"], success=d["green"], info=d["cyan"],
    nicks=[d["orange"], d["red"], d["yellow"], d["green"], d["cyan"], d["purple"], d["pink"], "#ff92df",
           "#69ff94", "#a4ffff", "#d6acff", "#ffffa5", "#ff6e6e", "#ffca85", "#9aedfe", "#ff9de2"],
)


def catppuccin(scheme, p):
    if scheme == "dark":
        return theme(
            "dark", bg=p["base"], sidebar=p["mantle"], elevated=p["surface0"], subtle=p["surface0"],
            fg=p["text"], emphasis=p["text"], muted=p["subtext0"], faint=p["overlay1"],
            border=p["surface0"], border_strong=p["surface1"],
            accent=p["mauve"], accent_hover=p["lavender"], accent_fg=p["crust"],
            danger=p["red"], warning=p["yellow"], success=p["green"], info=p["sky"],
            nicks=[p[k] for k in ["peach", "red", "yellow", "green", "teal", "sky", "sapphire", "blue",
                                  "lavender", "mauve", "pink", "flamingo", "rosewater", "maroon", "peach", "teal"]],
            avatar_fg=p["crust"],
        )
    return theme(
        "light", bg=p["base"], sidebar=p["mantle"], elevated="#ffffff", subtle=p["crust"],
        fg=p["text"], emphasis=p["text"], muted=p["subtext0"], faint=p["overlay1"],
        border=p["crust"], border_strong=p["surface0"],
        accent=p["mauve"], accent_hover="#7028e4", accent_fg="#ffffff",
        danger=p["red"], warning=p["peach"], success=p["green"], info=p["sapphire"],
        nicks=[p[k] for k in ["peach", "red", "yellow", "green", "teal", "sky", "sapphire", "blue",
                              "lavender", "mauve", "pink", "flamingo", "rosewater", "maroon", "peach", "teal"]],
    )


# https://catppuccin.com/palette
latte = dict(base="#eff1f5", mantle="#e6e9ef", crust="#dce0e8", surface0="#ccd0da", surface1="#bcc0cc",
             surface2="#acb0be", overlay0="#9ca0b0", overlay1="#8c8fa1", overlay2="#7c7f93", subtext0="#6c6f85",
             subtext1="#5c5f77", text="#4c4f69", lavender="#7287fd", blue="#1e66f5", sapphire="#209fb5",
             sky="#04a5e5", teal="#179299", green="#40a02b", yellow="#df8e1d", peach="#fe640b", maroon="#e64553",
             red="#d20f39", mauve="#8839ef", pink="#ea76cb", flamingo="#dd7878", rosewater="#dc8a78")
frappe = dict(base="#303446", mantle="#292c3c", crust="#232634", surface0="#414559", surface1="#51576d",
              surface2="#626880", overlay0="#737994", overlay1="#838ba7", overlay2="#949cbb", subtext0="#a5adce",
              subtext1="#b5bfe2", text="#c6d0f5", lavender="#babbf1", blue="#8caaee", sapphire="#85c1dc",
              sky="#99d1db", teal="#81c8be", green="#a6d189", yellow="#e5c890", peach="#ef9f76", maroon="#ea999c",
              red="#e78284", mauve="#ca9ee6", pink="#f4b8e4", flamingo="#eebebe", rosewater="#f2d5cf")
macchiato = dict(base="#24273a", mantle="#1e2030", crust="#181926", surface0="#363a4f", surface1="#494d64",
                 surface2="#5b6078", overlay0="#6e738d", overlay1="#8087a2", overlay2="#939ab7", subtext0="#a5adcb",
                 subtext1="#b8c0e0", text="#cad3f5", lavender="#b7bdf8", blue="#8aadf4", sapphire="#7dc4e4",
                 sky="#91d7e3", teal="#8bd5ca", green="#a6da95", yellow="#eed49f", peach="#f5a97f", maroon="#ee99a0",
                 red="#ed8796", mauve="#c6a0f6", pink="#f5bde6", flamingo="#f0c6c6", rosewater="#f4dbd6")
mocha = dict(base="#1e1e2e", mantle="#181825", crust="#11111b", surface0="#313244", surface1="#45475a",
             surface2="#585b70", overlay0="#6c7086", overlay1="#7f849c", overlay2="#9399b2", subtext0="#a6adc8",
             subtext1="#bac2de", text="#cdd6f4", lavender="#b4befe", blue="#89b4fa", sapphire="#74c7ec",
             sky="#89dceb", teal="#94e2d5", green="#a6e3a1", yellow="#f9e2af", peach="#fab387", maroon="#eba0ac",
             red="#f38ba8", mauve="#cba6f7", pink="#f5c2e7", flamingo="#f2cdcd", rosewater="#f5e0dc")

# https://ethanschoonover.com/solarized/
s = dict(base03="#002b36", base02="#073642", base01="#586e75", base00="#657b83", base0="#839496",
         base1="#93a1a1", base2="#eee8d5", base3="#fdf6e3", yellow="#b58900", orange="#cb4b16", red="#dc322f",
         magenta="#d33682", violet="#6c71c4", blue="#268bd2", cyan="#2aa198", green="#859900")
sol_nicks = [s["orange"], s["red"], s["yellow"], s["green"], s["cyan"], s["blue"], s["violet"], s["magenta"],
             "#b97a00", "#d4561f", "#6d7e00", "#1f8c84", "#1e74b2", "#5a5fb0", "#b8306f", "#c22d2b"]
# Body text and links are slightly adjusted from the canonical palette to
# reach WCAG AA contrast
solarized_dark = theme(
    "dark", bg=s["base03"], sidebar="#00252e", elevated=s["base02"], subtle=s["base02"],
    fg=s["base0"], emphasis=s["base1"], muted="#7f9196", faint="#5b6f76",
    border=s["base02"], border_strong="#0e4552",
    accent="#4aa0e0", accent_hover="#6cb4e8", accent_fg=s["base03"],
    danger="#e8615e", warning=s["yellow"], success=s["green"], info=s["cyan"],
    nicks=[s["orange"], s["red"], s["yellow"], s["green"], s["cyan"], s["blue"], s["violet"], s["magenta"],
           "#e0782f", "#e85b58", "#c9a227", "#9cb000", "#3fbfb4", "#4aa0e0", "#8d91d9", "#e05a9a"],
    avatar_fg=s["base03"],
)
solarized_light = theme(
    "light", bg=s["base3"], sidebar=s["base2"], elevated="#fffcf2", subtle=s["base2"],
    fg=s["base01"], emphasis="#3e535b", muted=s["base00"], faint="#8a9a9a",
    border="#e6dfc8", border_strong="#d9d1b8",
    accent="#1a6aa8", accent_hover="#155a90", accent_fg=s["base3"],
    danger="#c42b28", warning=s["yellow"], success=s["green"], info="#1f7f78",
    nicks=sol_nicks, avatar_fg=s["base3"],
)

# https://kippura.org/zenburnpage/
z = dict(bg="#3f3f3f", bg_1="#2b2b2b", bg_05="#383838", bg1="#4f4f4f", bg2="#5f5f5f", bg3="#6f6f6f",
         fg="#dcdccc", fg_1="#656555", fg1="#ffffef", red="#cc9393", red1="#dca3a3", red_1="#bc8383",
         orange="#dfaf8f", yellow="#f0dfaf", yellow_1="#e0cf9f", green="#7f9f7f", green1="#8fb28f",
         green2="#9fc59f", green3="#afd8af", green4="#bfebbf", cyan="#93e0e3", blue="#8cd0d3",
         blue1="#94bff3", blue_1="#7cb8bb", blue_2="#6ca0a3", magenta="#dc8cc3")
zenburn = theme(
    "dark", bg=z["bg"], sidebar=z["bg_05"], elevated=z["bg1"], subtle=z["bg1"],
    fg=z["fg"], emphasis=z["fg1"], muted="#a8a898", faint="#8a8a7a",
    border=z["bg1"], border_strong=z["bg2"],
    accent=z["blue"], accent_hover=z["cyan"], accent_fg=z["bg_1"],
    danger=z["red"], warning=z["yellow"], success=z["green2"], info=z["cyan"],
    nicks=[z["orange"], z["red"], z["yellow"], z["green2"], z["green4"], z["cyan"], z["blue"], z["blue1"],
           z["magenta"], z["red1"], z["yellow_1"], z["green3"], z["blue_1"], "#bfbfff", "#e3a8cf", "#efbf9f"],
    avatar_fg=z["bg_1"],
)

THEMES = {
    "dracula": dracula,
    "catppuccin-latte": catppuccin("light", latte),
    "catppuccin-frappe": catppuccin("dark", frappe),
    "catppuccin-macchiato": catppuccin("dark", macchiato),
    "catppuccin-mocha": catppuccin("dark", mocha),
    "solarized-light": solarized_light,
    "solarized-dark": solarized_dark,
    "zenburn": zenburn,
}


def block(selector, tokens, indent="\t"):
    lines = [f"{selector} {{"]
    for k, v in tokens.items():
        lines.append(f"{indent}{k}: {v};")
    lines.append("}")
    return "\n".join(lines)


out = [
    "/*",
    " * Color themes. Generated by tools/gen-themes.py, edit the palettes there.",
    " *",
    " * Text colors are adjusted to reach WCAG AA contrast on every background",
    " * they're shown on. Without a data-theme attribute, the light or dark",
    " * theme follows the system color scheme.",
    " */",
    "",
    block(':root,\n:root[data-theme="light"]', gamja_light),
    "",
    block(':root[data-theme="dark"]', gamja_dark),
    "",
    "@media (prefers-color-scheme: dark) {",
    "\t" + block(":root:not([data-theme])", gamja_dark, "\t\t").replace("\n", "\n\t"),
    "}",
]
for name, tokens in THEMES.items():
    out += ["", block(f':root[data-theme="{name}"]', tokens)]

root = os.path.join(os.path.dirname(__file__), "..")
with open(os.path.join(root, "src", "styles", "themes.css"), "w") as f:
    f.write("\n".join(out) + "\n")
