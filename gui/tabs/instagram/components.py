from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QPushButton, QLabel, QDialog, QLineEdit
)
from PyQt6.QtCore import Qt
from gui.styles import DIALOG_STYLE, INPUT_STYLE

class SettingsDialog(QDialog):
    def __init__(self, title, parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.setStyleSheet(DIALOG_STYLE)
        self.setModal(True)
        self.layout = QVBoxLayout(self)
        self.layout.setSpacing(15)
        self.layout.setContentsMargins(20, 20, 20, 20)
        
    def add_widget(self, widget):
        self.layout.addWidget(widget)
        
    def add_layout(self, layout):
        self.layout.addLayout(layout)

class ToggleHeader(QPushButton):
    def __init__(self, text, content_widget):
        super().__init__()
        self.content_widget = content_widget
        self.text_label = text
        self.setCheckable(True)
        self.setChecked(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                text-align: left;
                border: none;
                background: transparent;
                color: #e0e0e0;
                font-weight: bold;
                font-size: 16px;
                padding: 5px 0;
            }
            QPushButton:hover {
                color: #ffffff;
            }
        """)
        self.clicked.connect(self.toggle_view)
        self.update_text()

    def toggle_view(self):
        self.content_widget.setVisible(self.isChecked())
        self.update_text()

    def update_text(self):
        arrow = "▼" if self.isChecked() else "▶"
        self.setText(f"{arrow} {self.text_label}")

def create_header_input(label_text, default_val, width=50):
    container = QWidget()
    layout = QVBoxLayout(container)
    layout.setContentsMargins(0, 0, 0, 0)
    layout.setSpacing(2)
    lbl = QLabel(label_text)
    lbl.setStyleSheet("color: #abb2bf; font-size: 11px; font-weight: bold;")
    inp = QLineEdit(default_val)
    inp.setStyleSheet(INPUT_STYLE + "QLineEdit { background: transparent; padding: 4px; font-size: 12px; }")
    inp.setFixedWidth(width)
    layout.addWidget(lbl)
    layout.addWidget(inp)
    return container, inp
