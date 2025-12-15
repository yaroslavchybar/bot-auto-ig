"""
Centralized CSS Styles for the application.
"""

DARK_STYLE = """
QMainWindow, QWidget {
    background-color: #1a1a1a;
    color: #ffffff;
}
QTabWidget::pane {
    border: 1px solid #333;
    background-color: #1a1a1a;
}
QTabBar::tab {
    background-color: #2d2d2d;
    color: #888;
    padding: 8px 20px;
    margin-right: 2px;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
}
QTabBar::tab:selected {
    background-color: #ff4444;
    color: white;
}
QTabBar::tab:hover:!selected {
    background-color: #3d3d3d;
}
QGroupBox {
    border: 1px solid #333;
    border-radius: 5px;
    margin-top: 10px;
    padding-top: 10px;
    font-weight: bold;
}
QGroupBox::title {
    color: #ff4444;
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 5px;
}
QLineEdit, QComboBox, QTextEdit {
    background-color: #2d2d2d;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 8px;
    color: white;
}
QLineEdit:focus, QComboBox:focus {
    border-color: #ff4444;
}
QComboBox::drop-down {
    border: none;
    padding-right: 10px;
}
QComboBox::down-arrow {
    image: none;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid #888;
    margin-right: 5px;
}
QPushButton {
    background-color: #2d2d2d;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 8px 16px;
    color: white;
    font-weight: bold;
}
QPushButton:hover {
    background-color: #3d3d3d;
    border-color: #555;
}
QPushButton:pressed {
    background-color: #444;
}
QPushButton#startBtn {
    background-color: #2E7D32;
}
QPushButton#startBtn:hover {
    background-color: #388E3C;
}
QPushButton#stopBtn {
    background-color: #C62828;
}
QPushButton#stopBtn:hover {
    background-color: #D32F2F;
}
QListWidget {
    background-color: #1f1f1f;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 5px;
}
QListWidget::item {
    padding: 8px;
    border-bottom: 1px solid #333;
}
QListWidget::item:selected {
    background-color: #3d3d3d;
    color: white;
}
QListWidget::item:hover:!selected {
    background-color: #2d2d2d;
}
QRadioButton {
    color: white;
    spacing: 8px;
}
QRadioButton::indicator {
    width: 16px;
    height: 16px;
    border-radius: 8px;
    border: 2px solid #666;
    background-color: #2d2d2d;
}
QRadioButton::indicator:checked {
    background-color: #ff4444;
    border-color: #ff4444;
}
QCheckBox {
    color: white;
    spacing: 8px;
}
QCheckBox::indicator {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 2px solid #666;
    background-color: #2d2d2d;
}
QCheckBox::indicator:checked {
    background-color: #ff4444;
    border-color: #ff4444;
}
QTextEdit#logArea {
    background-color: #1f1f1f;
    border: 1px solid #333;
    font-family: Consolas, monospace;
    font-size: 12px;
}
QLabel#sectionHeader {
    color: #ff4444;
    font-weight: bold;
    font-size: 13px;
}
QScrollBar:vertical {
    background-color: #1a1a1a;
    width: 12px;
    margin: 0px;
    border: none;
}
QScrollBar::handle:vertical {
    background-color: #444;
    min-height: 30px;
    border-radius: 6px;
    margin: 2px;
}
QScrollBar::handle:vertical:hover {
    background-color: #555;
}
QScrollBar::handle:vertical:pressed {
    background-color: #ff4444;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0px;
}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
    background: none;
}
QScrollBar:horizontal {
    background-color: #1a1a1a;
    height: 12px;
    margin: 0px;
    border: none;
}
QScrollBar::handle:horizontal {
    background-color: #444;
    min-width: 30px;
    border-radius: 6px;
    margin: 2px;
}
QScrollBar::handle:horizontal:hover {
    background-color: #555;
}
QScrollBar::handle:horizontal:pressed {
    background-color: #ff4444;
}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
    width: 0px;
}
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {
    background: none;
}
"""

# --- PROFILES TAB STYLES ---

CARD_STYLE = """
    QFrame {
        background-color: #2b2d30;
        border-radius: 8px;
        border: 1px solid #3e4042;
    }
    QFrame:hover {
        border: 1px solid #5c5f61;
        background-color: #323437;
    }
    QLabel {
        background-color: transparent;
        border: none;
        color: #e0e0e0;
    }
    QLabel#profileName {
        font-size: 14px;
        font-weight: bold;
        color: #ffffff;
    }
    QLabel#proxyInfo {
        color: #8a8a8a;
        font-size: 12px;
    }
"""

STATUS_RUNNING = "color: #98c379; font-weight: bold;"  # Green
STATUS_IDLE = "color: #61afef; font-weight: bold;"     # Blue - using blue for idle/ready
STATUS_STOPPED = "color: #abb2bf;"                     # Gray

BUTTON_STYLE = """
    QPushButton {
        background-color: #3e4042;
        color: white;
        border-radius: 6px;
        padding: 6px 12px;
        border: none;
        font-weight: bold;
    }
    QPushButton:hover {
        background-color: #4e5052;
    }
    QPushButton:pressed {
        background-color: #2b2d30;
    }
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

PRIMARY_BTN_STYLE = """
    QPushButton {
        background-color: #61afef;
        color: white;
        border-radius: 8px;
        padding: 10px 20px;
        font-weight: bold;
        font-size: 14px;
    }
    QPushButton:hover {
        background-color: #74bdf7;
    }
    QPushButton:pressed {
        background-color: #4d8cc7;
    }
"""

INPUT_STYLE = """
    QLineEdit {
        background-color: #21252b;
        border: 1px solid #3e4042;
        border-radius: 6px;
        padding: 8px;
        color: #abb2bf;
        font-size: 13px;
    }
    QLineEdit:focus {
        border: 1px solid #61afef;
    }
"""

DIALOG_STYLE = """
    QDialog {
        background-color: #1e2125;
        color: #e0e0e0;
    }
    QLabel {
        color: #e0e0e0;
        font-size: 14px;
    }
    QGroupBox {
        border: 1px solid #3e4042;
        border-radius: 8px;
        margin-top: 20px;
        font-weight: bold;
        padding-top: 10px;
    }
    QGroupBox::title {
        subcontrol-origin: margin;
        left: 10px;
        padding: 0 5px;
        color: #e0e0e0;
    }
    QRadioButton {
        color: #e0e0e0;
        spacing: 8px;
    }
    QRadioButton::indicator {
        width: 14px;
        height: 14px;
        border-radius: 8px;
        border: 1px solid #5c5f61;
        background-color: #2b2d30;
    }
    QRadioButton::indicator:checked {
        border: 1px solid #61afef;
        background-color: #61afef;
    }
    QComboBox {
        background-color: #21252b;
        border: 1px solid #3e4042;
        border-radius: 6px;
        padding: 6px;
        color: #abb2bf;
    }
    QComboBox::drop-down {
        border: none;
    }
"""

CHECKBOX_STYLE = """
    QCheckBox {
        color: #e0e0e0;
        spacing: 8px;
    }
    QCheckBox::indicator {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1px solid #5c5f61;
        background-color: #2b2d30;
    }
    QCheckBox::indicator:checked {
        border: 1px solid #61afef;
        background-color: #61afef;
    }
"""
