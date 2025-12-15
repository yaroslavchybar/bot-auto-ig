import json
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QGroupBox,
    QTextEdit,
    QPushButton,
    QLabel,
    QSpinBox,
    QCheckBox,
)
from PyQt6.QtCore import Qt

from gui.workers.unfollow_worker import UnfollowWorker


class UnfollowTab(QWidget):
    """Tab for managing automated unfollowing."""

    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self.worker = None
        self.settings_path = Path(__file__).resolve().parents[2] / "unfollow_settings.json"
        self.loading_settings = False
        self.setup_ui()
        self.load_settings()
        self.connect_settings_signals()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(15, 15, 15, 15)
        layout.setSpacing(12)

        # Mode Selection
        mode_group = QGroupBox("🛠️ Режим работы")
        mode_layout = QVBoxLayout(mode_group)
        
        self.unfollow_cb = QCheckBox("Unfollow (Отписка от списка)")
        self.unfollow_cb.setChecked(True)
        
        self.approve_cb = QCheckBox("Approve requests (Подтверждать заявки)")
        self.approve_cb.setChecked(True)
        
        mode_layout.addWidget(self.unfollow_cb)
        mode_layout.addWidget(self.approve_cb)

        self.message_cb = QCheckBox("Send Messages (Рассылка)")
        self.message_cb.setChecked(False)
        mode_layout.addWidget(self.message_cb)
        layout.addWidget(mode_group)

        # Controls
        controls_row = QHBoxLayout()
        self.start_btn = QPushButton("▶️ Старт")
        self.start_btn.setMinimumHeight(40)
        self.start_btn.clicked.connect(self.start_unfollowing)
        
        self.stop_btn = QPushButton("⏹️ Стоп")
        self.stop_btn.setMinimumHeight(40)
        self.stop_btn.setEnabled(False)
        self.stop_btn.clicked.connect(self.stop_unfollowing)
        
        controls_row.addWidget(self.start_btn)
        controls_row.addWidget(self.stop_btn)
        layout.addLayout(controls_row)

        # Settings
        settings_group = QGroupBox("⚙️ Настройки задержки (сек)")
        settings_layout = QHBoxLayout(settings_group)
        
        self.min_delay_spin = QSpinBox()
        self.min_delay_spin.setRange(1, 3600)
        self.min_delay_spin.setValue(10)
        self.min_delay_spin.setPrefix("Min: ")
        
        self.max_delay_spin = QSpinBox()
        self.max_delay_spin.setRange(1, 3600)
        self.max_delay_spin.setValue(30)
        self.max_delay_spin.setPrefix("Max: ")

        settings_layout.addWidget(QLabel("Интервал между отписками:"))
        settings_layout.addWidget(self.min_delay_spin)
        settings_layout.addWidget(QLabel("-"))
        settings_layout.addWidget(self.max_delay_spin)
        settings_layout.addStretch()
        
        layout.addWidget(settings_group)

        # Log
        log_group = QGroupBox("📋 Лог")
        log_layout = QVBoxLayout(log_group)
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        log_layout.addWidget(self.log_area)
        layout.addWidget(log_group)

    def start_unfollowing(self):
        if self.worker and self.worker.isRunning():
            return

        self.log("▶️ Запуск задач...")
        self.save_settings()

        min_d = self.min_delay_spin.value()
        max_d = self.max_delay_spin.value()
        if min_d > max_d:
            min_d, max_d = max_d, min_d
            self.min_delay_spin.setValue(min_d)
            self.max_delay_spin.setValue(max_d)
            
        do_unfollow = self.unfollow_cb.isChecked()
        do_approve = self.approve_cb.isChecked()
        do_message = self.message_cb.isChecked()
        
        if not do_unfollow and not do_approve and not do_message:
            self.log("⚠️ Выберите хотя бы одно действие!")
            return

        self.worker = UnfollowWorker(
            delay_range=(min_d, max_d),
            do_unfollow=do_unfollow,
            do_approve=do_approve,
            do_message=do_message
        )
        self.worker.log_signal.connect(self.log)
        self.worker.finished_signal.connect(self.on_finished)
        self.worker.start()

        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)

    def stop_unfollowing(self):
        if self.worker:
            self.worker.stop()
            self.log("⏹️ Остановка запрошена...")
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)

    def on_finished(self):
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.log("✅ Задача завершена")

    def log(self, message: str):
        self.log_area.append(message)
        scrollbar = self.log_area.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def connect_settings_signals(self):
        self.min_delay_spin.valueChanged.connect(self.save_settings)
        self.max_delay_spin.valueChanged.connect(self.save_settings)
        self.unfollow_cb.stateChanged.connect(self.save_settings)
        self.approve_cb.stateChanged.connect(self.save_settings)
        self.message_cb.stateChanged.connect(self.save_settings)

    def load_settings(self):
        defaults = {
            "min_delay": 10, 
            "max_delay": 30,
            "do_unfollow": True,
            "do_approve": True,
            "do_message": False
        }
        self.loading_settings = True
        
        try:
            if self.settings_path.exists():
                data = json.loads(self.settings_path.read_text(encoding="utf-8"))
            else:
                data = defaults
        except Exception:
            data = defaults

        self.min_delay_spin.setValue(data.get("min_delay", 10))
        self.max_delay_spin.setValue(data.get("max_delay", 30))
        self.unfollow_cb.setChecked(data.get("do_unfollow", True))
        self.approve_cb.setChecked(data.get("do_approve", True))
        self.message_cb.setChecked(data.get("do_message", False))
        
        self.loading_settings = False

    def save_settings(self):
        if self.loading_settings:
            return
        
        data = {
            "min_delay": self.min_delay_spin.value(),
            "max_delay": self.max_delay_spin.value(),
            "do_unfollow": self.unfollow_cb.isChecked(),
            "do_approve": self.approve_cb.isChecked(),
            "do_message": self.message_cb.isChecked()
        }
        try:
            self.settings_path.write_text(json.dumps(data, indent=4), encoding="utf-8")
        except Exception as e:
            print(f"Failed to save settings: {e}")
