from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QPushButton, QLabel, QDialog, QLineEdit,
    QApplication, QTextEdit, QPlainTextEdit
)
from PyQt6.QtCore import Qt
from gui.styles import DIALOG_STYLE, INPUT_STYLE, TOGGLE_HEADER_STYLE, HEADER_LABEL_SMALL_STYLE, HEADER_INPUT_STYLE

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

    def mousePressEvent(self, event):
        focused_widget = QApplication.focusWidget()
        if focused_widget and isinstance(focused_widget, (QLineEdit, QTextEdit, QPlainTextEdit)):
            focused_widget.clearFocus()
        super().mousePressEvent(event)

class ToggleHeader(QPushButton):
    def __init__(self, text, content_widget):
        super().__init__()
        self.content_widget = content_widget
        self.text_label = text
        self.setCheckable(True)
        self.setChecked(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setStyleSheet(TOGGLE_HEADER_STYLE)
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
    lbl.setStyleSheet(HEADER_LABEL_SMALL_STYLE)
    inp = QLineEdit(default_val)
    inp.setStyleSheet(HEADER_INPUT_STYLE)
    inp.setFixedWidth(width)
    layout.addWidget(lbl)
    layout.addWidget(inp)
    return container, inp
