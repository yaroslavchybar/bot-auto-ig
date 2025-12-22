"""
Centralized CSS Styles for the application.
"""

BG_MAIN = "#1a1a1a"
TEXT_WHITE = "#ffffff"
BORDER_DARK = "#333"
PANEL_BG = "#2d2d2d"
MUTED_TEXT = "#888"
ACCENT_BLUE = "#61afef"
HOVER_DARK = "#3d3d3d"
BORDER_MEDIUM = "#444"
BORDER_LIGHT = "#555"
BG_SOFT = "#1f1f1f"
GREEN = "#2E7D32"
GREEN_HOVER = "#388E3C"
RED = "#C62828"
RED_HOVER = "#D32F2F"
INDICATOR_BORDER = "#666"
ACCENT_RED = "#ff4444"
LIGHT_TEXT = "#e0e0e0"
SOFT_TEXT = "#abb2bf"
FRAME_BG = "#2b2d30"
FRAME_BORDER = "#3e4042"
FRAME_HOVER_BG = "#323437"
FRAME_HOVER_BORDER = "#5c5f61"
DIALOG_BG = "#1e2125"
INPUT_BG = "#21252b"
ACCENT_BLUE_HOVER = "#74bdf7"
ACCENT_BLUE_PRESSED = "#4d8cc7"
TEXT_SUBTLE = "#8a8a8a"
GEN_UA_BORDER = "#5c6370"
GEN_UA_HOVER_BG = "#4b5263"
ORDER_LIST_BORDER = "#2c313a"
SCROLL_AREA_HANDLE_BG = "#4b4d50"
TOTP_FRAME_BG = "#262a30"
RED_SOFT = "#e06c75"

def _hex_to_rgb(hex_color):
    h = hex_color.lstrip("#")
    return f"{int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)}"

def _action_button_style(hex_color, radius, padding, font_size, pressed_alpha=None):
    rgb = _hex_to_rgb(hex_color)
    style = f"""
    QPushButton {{
        background-color: rgba({rgb}, 0.2);
        color: {hex_color};
        border: 1px solid {hex_color};
        border-radius: {radius}px;
        padding: {padding};
        font-size: {font_size}px;
        font-weight: bold;
    }}
    QPushButton:hover {{
        background-color: rgba({rgb}, 0.3);
    }}
    """
    if pressed_alpha is not None:
        style += f"""
    QPushButton:pressed {{
        background-color: rgba({rgb}, {pressed_alpha});
    }}
    """
    return style

DARK_STYLE = f"""
QMainWindow, QWidget {{
    background-color: {BG_MAIN};
    color: {TEXT_WHITE};
}}
QTabWidget::pane {{
    border: 1px solid {BORDER_DARK};
    background-color: {BG_MAIN};
}}
QTabBar::tab {{
    background-color: {PANEL_BG};
    color: {MUTED_TEXT};
    padding: 8px 20px;
    margin-right: 2px;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
}}
QTabBar::tab:selected {{
    background-color: {ACCENT_BLUE};
    color: {TEXT_WHITE};
}}
QTabBar::tab:hover:!selected {{
    background-color: {HOVER_DARK};
}}
QGroupBox {{
    border: 1px solid {BORDER_DARK};
    border-radius: 5px;
    margin-top: 10px;
    padding-top: 10px;
    font-weight: bold;
}}
QGroupBox::title {{
    color: {ACCENT_BLUE};
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 5px;
}}
QLineEdit, QComboBox, QTextEdit {{
    background-color: {PANEL_BG};
    border: 1px solid {BORDER_MEDIUM};
    border-radius: 4px;
    padding: 8px;
    color: {TEXT_WHITE};
}}
QLineEdit:focus, QComboBox:focus {{
    border-color: {ACCENT_BLUE};
}}
QComboBox::drop-down {{
    border: none;
    padding-right: 10px;
}}
QComboBox::down-arrow {{
    image: none;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid {MUTED_TEXT};
    margin-right: 5px;
}}
QPushButton {{
    background-color: {PANEL_BG};
    border: 1px solid {BORDER_MEDIUM};
    border-radius: 4px;
    padding: 8px 16px;
    color: {TEXT_WHITE};
    font-weight: bold;
}}
QPushButton:hover {{
    background-color: {HOVER_DARK};
    border-color: {BORDER_LIGHT};
}}
QPushButton:pressed {{
    background-color: {BORDER_MEDIUM};
}}
QPushButton#startBtn {{
    background-color: {GREEN};
}}
QPushButton#startBtn:hover {{
    background-color: {GREEN_HOVER};
}}
QPushButton#stopBtn {{
    background-color: {RED};
}}
QPushButton#stopBtn:hover {{
    background-color: {RED_HOVER};
}}
QListWidget {{
    background-color: {BG_SOFT};
    border: 1px solid {BORDER_DARK};
    border-radius: 4px;
    padding: 5px;
}}
QListWidget::item {{
    padding: 8px;
    border-bottom: 1px solid {BORDER_DARK};
}}
QListWidget::item:selected {{
    background-color: {HOVER_DARK};
    color: {TEXT_WHITE};
}}
QListWidget::item:hover:!selected {{
    background-color: {PANEL_BG};
}}
QRadioButton {{
    color: {TEXT_WHITE};
    spacing: 8px;
}}
QRadioButton::indicator {{
    width: 16px;
    height: 16px;
    border-radius: 8px;
    border: 2px solid {INDICATOR_BORDER};
    background-color: {PANEL_BG};
}}
QRadioButton::indicator:checked {{
    background-color: {ACCENT_RED};
    border-color: {ACCENT_RED};
}}
QCheckBox {{
    color: {TEXT_WHITE};
    spacing: 8px;
}}
QCheckBox::indicator {{
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 2px solid {INDICATOR_BORDER};
    background-color: {PANEL_BG};
}}
QCheckBox::indicator:checked {{
    background-color: {ACCENT_RED};
    border-color: {ACCENT_RED};
}}
QTextEdit#logArea {{
    background-color: {BG_SOFT};
    border: 1px solid {BORDER_DARK};
    font-family: Consolas, monospace;
    font-size: 12px;
}}
QLabel#sectionHeader {{
    color: {ACCENT_BLUE};
    font-weight: bold;
    font-size: 13px;
}}
QScrollBar:vertical, QScrollBar:horizontal {{
    background-color: {BG_MAIN};
    margin: 0px;
    border: none;
}}
QScrollBar:vertical {{ width: 12px; }}
QScrollBar:horizontal {{ height: 12px; }}
QScrollBar::handle:vertical, QScrollBar::handle:horizontal {{
    background-color: {BORDER_MEDIUM};
    border-radius: 6px;
    margin: 2px;
}}
QScrollBar::handle:vertical:hover, QScrollBar::handle:horizontal:hover {{
    background-color: {BORDER_LIGHT};
}}
QScrollBar::handle:vertical:pressed, QScrollBar::handle:horizontal:pressed {{
    background-color: {ACCENT_RED};
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical, QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
    height: 0px; width: 0px;
}}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical, QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {{
    background: none;
}}
"""

# --- PROFILES TAB STYLES ---

CARD_STYLE = f"""
    QFrame {{
        background-color: {FRAME_BG};
        border-radius: 8px;
        border: 1px solid {FRAME_BORDER};
    }}
    QFrame:hover {{
        border: 1px solid {FRAME_HOVER_BORDER};
        background-color: {FRAME_HOVER_BG};
    }}
    QLabel {{
        background-color: transparent;
        border: none;
        color: {LIGHT_TEXT};
    }}
    QLabel#profileName {{
        font-size: 14px;
        font-weight: bold;
        color: {TEXT_WHITE};
    }}
    QLabel#proxyInfo {{
        color: {TEXT_SUBTLE};
        font-size: 12px;
    }}
"""

STATUS_RUNNING = "color: #98c379; font-weight: bold;"
STATUS_IDLE = f"color: {ACCENT_BLUE}; font-weight: bold;"
STATUS_STOPPED = f"color: {SOFT_TEXT};"

BUTTON_STYLE = f"""
    QPushButton {{
        background-color: {FRAME_BORDER};
        color: {TEXT_WHITE};
        border-radius: 6px;
        padding: 6px 12px;
        border: none;
        font-weight: bold;
    }}
    QPushButton:hover {{
        background-color: #4e5052;
    }}
    QPushButton:pressed {{
        background-color: {FRAME_BG};
    }}
"""

ACTION_BTN_STYLE = """
    QPushButton {
        background-color: transparent;
        border-radius: 4px;
        padding: 4px;
    }
    QPushButton:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }
    QPushButton:pressed {
        background-color: rgba(255, 255, 255, 0.2);
    }
"""

PRIMARY_BTN_STYLE = f"""
    QPushButton {{
        background-color: {ACCENT_BLUE};
        color: {TEXT_WHITE};
        border-radius: 8px;
        padding: 10px 20px;
        font-weight: bold;
        font-size: 14px;
    }}
    QPushButton:hover {{
        background-color: {ACCENT_BLUE_HOVER};
    }}
    QPushButton:pressed {{
        background-color: {ACCENT_BLUE_PRESSED};
    }}
"""
PRIMARY_SAVE_BTN_STYLE = PRIMARY_BTN_STYLE.replace("QPushButton", "QPushButton#saveBtn")

INPUT_STYLE = f"""
    QLineEdit {{
        background-color: {INPUT_BG};
        border: 1px solid {FRAME_BORDER};
        border-radius: 6px;
        padding: 8px;
        color: {SOFT_TEXT};
        font-size: 13px;
    }}
    QLineEdit:focus {{
        border: 1px solid {ACCENT_BLUE};
    }}
"""

DIALOG_STYLE = f"""
    QDialog {{
        background-color: {DIALOG_BG};
        color: {LIGHT_TEXT};
    }}
    QLabel {{
        color: {LIGHT_TEXT};
        font-size: 14px;
        background-color: transparent;
        border: none;
    }}
    QScrollArea {{
        background: transparent;
        border: none;
    }}
    QAbstractScrollArea::viewport {{
        background: transparent;
    }}
    QTextEdit {{
        background-color: {INPUT_BG};
        border: 1px solid {FRAME_BORDER};
        border-radius: 6px;
        padding: 8px;
        color: {SOFT_TEXT};
        font-size: 13px;
    }}
    QTextEdit:focus {{
        border: 1px solid {ACCENT_BLUE};
    }}
    QTabWidget::pane {{
        border: none;
    }}
    QTabBar::tab {{
        background-color: {FRAME_BG};
        color: {SOFT_TEXT};
        padding: 8px 16px;
        border-top-left-radius: 8px;
        border-top-right-radius: 8px;
        margin-right: 6px;
    }}
    QTabBar::tab:selected {{
        background-color: {ACCENT_BLUE};
        color: {TEXT_WHITE};
    }}
    QTabBar::tab:!selected:hover {{
        background-color: {FRAME_HOVER_BG};
    }}
    QGroupBox {{
        border: 1px solid {FRAME_BORDER};
        border-radius: 8px;
        margin-top: 20px;
        font-weight: bold;
        padding-top: 10px;
    }}
    QGroupBox::title {{
        subcontrol-origin: margin;
        left: 10px;
        padding: 0 5px;
        color: {LIGHT_TEXT};
    }}
    QRadioButton {{
        color: {LIGHT_TEXT};
        spacing: 8px;
    }}
    QRadioButton::indicator {{
        width: 14px;
        height: 14px;
        border-radius: 8px;
        border: 1px solid {FRAME_HOVER_BORDER};
        background-color: {FRAME_BG};
    }}
    QRadioButton::indicator:checked {{
        border: 1px solid {ACCENT_BLUE};
        background-color: {ACCENT_BLUE};
    }}
    QComboBox {{
        background-color: {INPUT_BG};
        border: 1px solid {FRAME_BORDER};
        border-radius: 6px;
        padding: 6px;
        color: {SOFT_TEXT};
    }}
    QComboBox::drop-down {{
        border: none;
    }}
"""

CHECKBOX_STYLE = f"""
    QCheckBox {{
        color: {LIGHT_TEXT};
        spacing: 8px;
        background-color: transparent;
    }}
    QCheckBox::indicator {{
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1px solid {FRAME_HOVER_BORDER};
        background-color: {FRAME_BG};
    }}
    QCheckBox::indicator:checked {{
        border: 1px solid {ACCENT_BLUE};
        background-color: {ACCENT_BLUE};
    }}
"""

TAB_BACKGROUND_STYLE = f"background-color: {DIALOG_BG};"
TITLE_LABEL_STYLE = f"color: {TEXT_WHITE}; font-size: 28px; font-weight: bold;"
SUBTITLE_LABEL_STYLE = f"color: {SOFT_TEXT}; font-size: 14px;"
STATUS_BAR_STYLE = f"background-color: {PANEL_BG}; border-top: 1px solid {BORDER_MEDIUM};"
STATUS_LABEL_STYLE = f"color: {MUTED_TEXT}; font-size: 12px;"

SCROLL_AREA_STYLE = f"""
    QScrollArea {{ background: transparent; border: none; }}
    QScrollBar:vertical {{
        border: none;
        background: {FRAME_BG};
        width: 8px;
        border-radius: 4px;
    }}
    QScrollBar::handle:vertical {{
        background: {SCROLL_AREA_HANDLE_BG};
        border-radius: 4px;
    }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
        height: 0px;
    }}
"""
SCROLL_AREA_BASIC_STYLE = "QScrollArea { background: transparent; border: none; }"
CONTENT_TRANSPARENT_STYLE = "background: transparent;"
FRAME_TRANSPARENT_STYLE = "QFrame { background: transparent; border: none; }"

TOTP_FRAME_STYLE = f"""
    QFrame {{
        background-color: {TOTP_FRAME_BG};
        border-radius: 12px;
        border: 1px solid {FRAME_BORDER};
        padding: 10px;
    }}
"""
TOTP_LABEL_STYLE = f"color: {LIGHT_TEXT}; font-weight: bold; font-size: 14px; border: none;"
CANCEL_BTN_STYLE = f"background: transparent; color: {SOFT_TEXT}; border: none; font-weight: bold;"

GEN_UA_BTN_STYLE = f"""
    QPushButton {{
        background-color: {FRAME_BORDER};
        color: {TEXT_WHITE};
        border: 1px solid {GEN_UA_BORDER};
        border-radius: 4px;
        font-size: 16px;
    }}
    QPushButton:hover {{
        background-color: {GEN_UA_HOVER_BG};
    }}
"""

STATUS_INDICATOR_STYLE_TEMPLATE = "color: {color}; font-size: 14px;"
TOTP_SECRET_INPUT_STYLE = INPUT_STYLE + f"border: none; background: {DIALOG_BG};"
TOTP_CODE_DISPLAY_STYLE = INPUT_STYLE + f"color: {ACCENT_BLUE}; font-weight: bold; background: {DIALOG_BG}; border: none;"

START_BUTTON_SMALL_STYLE = _action_button_style(ACCENT_BLUE, 4, "4px 10px", 11)
STOP_BUTTON_SMALL_STYLE = _action_button_style(RED_SOFT, 4, "4px 10px", 11)

ACTION_BUTTON_START_STYLE = _action_button_style(ACCENT_BLUE, 8, "10px 20px", 14)
ACTION_BUTTON_STOP_STYLE = _action_button_style(RED_SOFT, 8, "10px 20px", 14)

TOGGLE_HEADER_STYLE = f"""
    QPushButton {{
        text-align: left;
        border: none;
        background: transparent;
        color: {LIGHT_TEXT};
        font-weight: bold;
        font-size: 16px;
        padding: 5px 0;
    }}
    QPushButton:hover {{
        color: {TEXT_WHITE};
    }}
"""
HEADER_LABEL_SMALL_STYLE = f"color: {SOFT_TEXT}; font-size: 11px; font-weight: bold;"
HEADER_INPUT_STYLE = INPUT_STYLE + "QLineEdit { background: transparent; padding: 4px; font-size: 12px; }"

ACTION_ORDER_LIST_STYLE = f"""
    QListWidget {{
        background-color: {INPUT_BG};
        border: 1px solid {FRAME_BORDER};
        border-radius: 6px;
        color: {SOFT_TEXT};
        padding: 5px;
    }}
    QListWidget::item {{
        padding: 8px;
        border-bottom: 1px solid {ORDER_LIST_BORDER};
    }}
    QListWidget::item:selected {{
        background-color: {ORDER_LIST_BORDER};
    }}
"""

SOURCE_LISTS_LABEL_STYLE = f"color: {ACCENT_BLUE}; font-weight: bold; font-size: 14px;"
ACTION_BTN_SECONDARY_STYLE = ACTION_BTN_STYLE + f"font-size: 14px; color: {SOFT_TEXT};"
ACTION_BTN_DANGER_STYLE = ACTION_BTN_STYLE + f"font-size: 14px; color: {RED_SOFT};"
INPUT_COMBO_PADDING_STYLE = INPUT_STYLE + "padding: 5px;"

LOG_TEXTEDIT_STYLE = f"""
    QTextEdit {{
        background-color: {INPUT_BG};
        border: 1px solid {FRAME_BORDER};
        border-radius: 8px;
        color: {SOFT_TEXT};
        padding: 10px;
        font-family: 'Consolas', monospace;
        font-size: 12px;
    }}
"""

EMPTY_LABEL_STYLE = f"color: {SOFT_TEXT}; font-style: italic; margin-top: 20px;"

BUTTON_DANGER_STYLE = f"""
    QPushButton {{
        background-color: rgba(224, 108, 117, 0.2);
        color: {RED_SOFT};
        border: 1px solid {RED_SOFT};
        border-radius: 6px;
        padding: 6px 12px;
        font-weight: bold;
    }}
    QPushButton:hover {{
        background-color: rgba(224, 108, 117, 0.3);
    }}
    QPushButton:pressed {{
        background-color: rgba(224, 108, 117, 0.35);
    }}
"""
