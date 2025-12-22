from PyQt6.QtWidgets import QWidget, QVBoxLayout, QTextEdit, QApplication, QLineEdit, QPlainTextEdit
from PyQt6.QtCore import Qt
from gui.styles import LOG_TEXTEDIT_STYLE

class LogsTab(QWidget):
    def __init__(self, main_window):
        super().__init__(parent=main_window)
        self.main_window = main_window
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(15)
        
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        self.log_area.setStyleSheet(LOG_TEXTEDIT_STYLE)
        layout.addWidget(self.log_area)

    def mousePressEvent(self, event):
        focused_widget = QApplication.focusWidget()
        if focused_widget and isinstance(focused_widget, (QLineEdit, QTextEdit, QPlainTextEdit)):
            focused_widget.clearFocus()
        super().mousePressEvent(event)
    
    def add_log(self, text: str):
        self.log_area.append(text)
        sb = self.log_area.verticalScrollBar()
        if sb:
            sb.setValue(sb.maximum())
