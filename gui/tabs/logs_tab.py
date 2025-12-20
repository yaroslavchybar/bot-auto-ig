from PyQt6.QtWidgets import QWidget, QVBoxLayout, QTextEdit
from PyQt6.QtCore import Qt

class LogsTab(QWidget):
    def __init__(self, main_window):
        super().__init__(parent=main_window)
        self.main_window = main_window
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(15)
        
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        self.log_area.setStyleSheet("""
            QTextEdit {
                background-color: #21252b;
                border: 1px solid #3e4042;
                border-radius: 8px;
                color: #abb2bf;
                padding: 10px;
                font-family: 'Consolas', monospace;
                font-size: 12px;
            }
        """)
        layout.addWidget(self.log_area)
    
    def add_log(self, text: str):
        self.log_area.append(text)
        sb = self.log_area.verticalScrollBar()
        if sb:
            sb.setValue(sb.maximum())
