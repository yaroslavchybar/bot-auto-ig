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
)
from PyQt6.QtCore import Qt

from gui.workers.follow_worker import AutoFollowWorker


class FollowTab(QWidget):
    """Auto follow automation: loops through all profiles with assigned accounts."""

    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self.worker = None
        self.settings_path = Path(__file__).resolve().parents[2] / "follow_settings.json"
        self.loading_settings = False
        self.setup_ui()
        self.load_settings()
        self.connect_settings_signals()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(15, 15, 15, 15)
        layout.setSpacing(12)

        controls_row = QHBoxLayout()
        self.start_btn = QPushButton("▶️ Старт")
        self.start_btn.setObjectName("startBtn")
        self.start_btn.clicked.connect(self.start_following)
        self.stop_btn = QPushButton("⏹️ Стоп")
        self.stop_btn.setObjectName("stopBtn")
        self.stop_btn.setEnabled(False)
        self.stop_btn.clicked.connect(self.stop_following)
        controls_row.addWidget(self.start_btn)
        controls_row.addWidget(self.stop_btn)
        controls_row.addStretch()
        layout.addLayout(controls_row)

        settings_group = QGroupBox("⚙️ Настройки взаимодействий")
        settings_layout = QVBoxLayout(settings_group)

        highlights_row = QHBoxLayout()
        highlights_row.addWidget(QLabel("Хайлайты на аккаунт:"))
        self.highlights_min_spin = QSpinBox()
        self.highlights_min_spin.setRange(0, 10)
        self.highlights_min_spin.setValue(2)
        self.highlights_max_spin = QSpinBox()
        self.highlights_max_spin.setRange(0, 10)
        self.highlights_max_spin.setValue(4)
        highlights_row.addWidget(self.highlights_min_spin)
        highlights_row.addWidget(QLabel("до"))
        highlights_row.addWidget(self.highlights_max_spin)
        highlights_row.addStretch()
        settings_layout.addLayout(highlights_row)

        likes_row = QHBoxLayout()
        likes_row.addWidget(QLabel("Лайков на аккаунт:"))
        self.likes_min_spin = QSpinBox()
        self.likes_min_spin.setRange(0, 10)
        self.likes_min_spin.setValue(1)
        self.likes_max_spin = QSpinBox()
        self.likes_max_spin.setRange(0, 10)
        self.likes_max_spin.setValue(2)
        likes_row.addWidget(self.likes_min_spin)
        likes_row.addWidget(QLabel("до"))
        likes_row.addWidget(self.likes_max_spin)
        likes_row.addStretch()
        settings_layout.addLayout(likes_row)

        follow_limit_row = QHBoxLayout()
        follow_limit_row.addWidget(QLabel("Макс. подписок у цели:"))
        self.following_limit_spin = QSpinBox()
        self.following_limit_spin.setRange(0, 100000)
        self.following_limit_spin.setValue(3000)
        follow_limit_row.addWidget(self.following_limit_spin)
        follow_limit_row.addStretch()
        settings_layout.addLayout(follow_limit_row)

        layout.addWidget(settings_group)

        log_group = QGroupBox("📋 Лог")
        log_layout = QVBoxLayout(log_group)
        self.log_area = QTextEdit()
        self.log_area.setReadOnly(True)
        self.log_area.setMaximumHeight(160)
        log_layout.addWidget(self.log_area)
        layout.addWidget(log_group)

        layout.addStretch()

    def start_following(self):
        if self.worker and self.worker.isRunning():
            return

        self.log("▶️ Запуск автоподписки для всех профилей с назначенными аккаунтами.")
        self.save_settings()

        highlights_range = (
            self.highlights_min_spin.value(),
            self.highlights_max_spin.value(),
        )
        likes_range = (
            self.likes_min_spin.value(),
            self.likes_max_spin.value(),
        )
        following_limit = self.following_limit_spin.value()

        self.worker = AutoFollowWorker(
            highlights_range=highlights_range,
            likes_range=likes_range,
            following_limit=following_limit,
        )
        self.worker.log_signal.connect(self.log)
        self.worker.finished_signal.connect(self.on_follow_finished)
        self.worker.start()

        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(True)

    def stop_following(self):
        if self.worker:
            self.worker.stop()
            self.log("⏹️ Остановка запрошена...")
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)

    def on_follow_finished(self):
        self.start_btn.setEnabled(True)
        self.stop_btn.setEnabled(False)
        self.log("✅ Задача завершена")

    def log(self, message: str):
        self.log_area.append(message)
        scrollbar = self.log_area.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def connect_settings_signals(self):
        """Persist settings whenever user changes controls."""
        for spin in [
            self.highlights_min_spin,
            self.highlights_max_spin,
            self.likes_min_spin,
            self.likes_max_spin,
            self.following_limit_spin,
        ]:
            spin.valueChanged.connect(self.save_settings)

    def load_settings(self):
        """Load saved UI settings from disk."""
        defaults = {
            "highlights_min": 2,
            "highlights_max": 4,
            "likes_min": 1,
            "likes_max": 2,
            "following_limit": 3000,
        }

        self.loading_settings = True
        data = defaults.copy()

        if self.settings_path.exists():
            try:
                loaded = json.loads(self.settings_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data.update(loaded)
            except Exception as e:
                print(f"Failed to load Follow settings: {e}")

        self.highlights_min_spin.setValue(data.get("highlights_min", defaults["highlights_min"]))
        self.highlights_max_spin.setValue(data.get("highlights_max", defaults["highlights_max"]))
        self.likes_min_spin.setValue(data.get("likes_min", defaults["likes_min"]))
        self.likes_max_spin.setValue(data.get("likes_max", defaults["likes_max"]))
        self.following_limit_spin.setValue(data.get("following_limit", defaults["following_limit"]))

        self.loading_settings = False

    def save_settings(self):
        """Save current UI settings to disk."""
        if self.loading_settings:
            return

        payload = {
            "highlights_min": self.highlights_min_spin.value(),
            "highlights_max": self.highlights_max_spin.value(),
            "likes_min": self.likes_min_spin.value(),
            "likes_max": self.likes_max_spin.value(),
            "following_limit": self.following_limit_spin.value(),
        }

        try:
            self.settings_path.write_text(json.dumps(payload, indent=4, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"Failed to save Follow settings: {e}")
