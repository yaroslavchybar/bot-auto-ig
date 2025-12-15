import json
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QPushButton, QLabel,
    QGroupBox, QMessageBox, QScrollArea, QFrame, QRadioButton, QButtonGroup,
    QLineEdit, QComboBox, QTextEdit, QCheckBox
)
from PyQt6.QtCore import Qt
from datetime import datetime
from core.models import ThreadsAccount, ScrollingConfig
from gui.workers.instagram_worker import InstagramScrollingWorker

class InstagramTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self.worker = None
        self.onboarding_worker = None
        self.settings_path = Path(__file__).resolve().parents[2] / "instagram_settings.json"
        self.loading_settings = False
        self.setup_ui()
        self.load_settings()
        self.connect_settings_signals()

    def setup_ui(self):
        # Create the main tab widget
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # Create a scroll area
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        
        # Create the content widget that will be scrollable
        content_widget = QWidget()
        layout = QVBoxLayout(content_widget)
        layout.setContentsMargins(15, 15, 15, 15)
        layout.setSpacing(15)
        
        
        
        # === НАСТРОЙКИ СКРОЛЛИНГА SECTION ===
        scrolling_group = QGroupBox("📜 Настройки скроллинга")
        scrolling_layout = QVBoxLayout(scrolling_group)
        
        # Profile type row - only private profiles
        scroll_profile_row = QHBoxLayout()
        scroll_profile_label = QLabel("📂 Профиль:")
        scroll_profile_value = QLabel("Приватные")
        scroll_profile_value.setStyleSheet("font-weight: bold; color: #007acc;")
        scroll_profile_row.addWidget(scroll_profile_label)
        scroll_profile_row.addWidget(scroll_profile_value)
        scroll_profile_row.addStretch()
        scrolling_layout.addLayout(scroll_profile_row)

        # Activity Type row (Checkboxes)
        activity_row = QHBoxLayout()
        activity_label = QLabel("🎯 Активность:")
        self.feed_checkbox = QCheckBox("Лента")
        self.feed_checkbox.setChecked(True)
        self.reels_checkbox = QCheckBox("Reels")
        
        activity_row.addWidget(activity_label)
        activity_row.addWidget(self.feed_checkbox)
        activity_row.addWidget(self.reels_checkbox)
        activity_row.addStretch()
        scrolling_layout.addLayout(activity_row)
        
        # Actions header
        actions_header = QLabel("💫 Действия")
        actions_header.setObjectName("sectionHeader")
        scrolling_layout.addWidget(actions_header)
        percent_options = [f"{i}%" for i in range(0, 101, 10)]

        actions_split = QHBoxLayout()
        actions_split.setSpacing(12)

        # Feed actions (form-style, compact)
        feed_actions_group = QGroupBox("Лента")
        feed_actions_layout = QFormLayout(feed_actions_group)
        feed_actions_layout.setLabelAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        feed_actions_layout.setFormAlignment(Qt.AlignmentFlag.AlignTop)
        feed_actions_layout.setHorizontalSpacing(12)
        feed_actions_layout.setVerticalSpacing(6)

        self.feed_likes_chance_slider = QComboBox()
        self.feed_likes_chance_slider.addItems(percent_options)
        self.feed_likes_chance_slider.setCurrentIndex(1)  # 10%
        feed_actions_layout.addRow("❤️ Лайки:", self.feed_likes_chance_slider)

        self.feed_carousel_chance_slider = QComboBox()
        self.feed_carousel_chance_slider.addItems(percent_options)
        self.feed_carousel_chance_slider.setCurrentIndex(0)  # 0%
        feed_actions_layout.addRow("🖼️ Карусели:", self.feed_carousel_chance_slider)

        self.feed_carousel_max_input = QLineEdit("3")
        self.feed_carousel_max_input.setMaximumWidth(60)
        feed_actions_layout.addRow("🖼️ Макс слайдов:", self.feed_carousel_max_input)

        self.watch_stories_checkbox = QCheckBox("Смотреть в начале")
        self.watch_stories_checkbox.setChecked(True)
        feed_actions_layout.addRow("👀 Сторис:", self.watch_stories_checkbox)

        self.feed_stories_max_input = QLineEdit("3")
        self.feed_stories_max_input.setMaximumWidth(60)
        feed_actions_layout.addRow("👀 Макс сторис:", self.feed_stories_max_input)

        self.feed_follows_chance_slider = QComboBox()
        self.feed_follows_chance_slider.addItems(percent_options)
        self.feed_follows_chance_slider.setCurrentIndex(5)  # 50%
        feed_actions_layout.addRow("➕ Подписки:", self.feed_follows_chance_slider)

        actions_split.addWidget(feed_actions_group, 1)

        # Reels actions (form-style, compact)
        reels_actions_group = QGroupBox("Reels")
        reels_actions_layout = QFormLayout(reels_actions_group)
        reels_actions_layout.setLabelAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        reels_actions_layout.setFormAlignment(Qt.AlignmentFlag.AlignTop)
        reels_actions_layout.setHorizontalSpacing(12)
        reels_actions_layout.setVerticalSpacing(6)

        self.reels_likes_chance_slider = QComboBox()
        self.reels_likes_chance_slider.addItems(percent_options)
        self.reels_likes_chance_slider.setCurrentIndex(1)  # 10%
        reels_actions_layout.addRow("❤️ Лайки:", self.reels_likes_chance_slider)

        self.reels_follows_chance_slider = QComboBox()
        self.reels_follows_chance_slider.addItems(percent_options)
        self.reels_follows_chance_slider.setCurrentIndex(5)  # 50%
        reels_actions_layout.addRow("➕ Подписки:", self.reels_follows_chance_slider)

        actions_split.addWidget(reels_actions_group, 1)
        scrolling_layout.addLayout(actions_split)
        
        # Time range row
        time_row = QHBoxLayout()
        time_row.addWidget(QLabel("⏱️ Время:"))
        self.scroll_time_min_input = QLineEdit("1 мин")
        self.scroll_time_min_input.setMaximumWidth(70)
        time_row.addWidget(self.scroll_time_min_input)
        time_row.addWidget(QLabel("до"))
        self.scroll_time_max_input = QLineEdit("3 мин")
        self.scroll_time_max_input.setMaximumWidth(70)
        time_row.addWidget(self.scroll_time_max_input)
        time_row.addStretch()
        scrolling_layout.addLayout(time_row)
        
        layout.addWidget(scrolling_group)
        
        # === SCROLLING CONTROLS ===
        scrolling_controls_row = QHBoxLayout()
        self.start_scrolling_btn = QPushButton("🔄 Старт скроллинг")
        self.start_scrolling_btn.setObjectName("startBtn")
        self.start_scrolling_btn.clicked.connect(self.start_scrolling)
        self.stop_scrolling_btn = QPushButton("🛑 Стоп скроллинг")
        self.stop_scrolling_btn.setObjectName("stopBtn")
        self.stop_scrolling_btn.clicked.connect(self.stop_scrolling)
        self.stop_scrolling_btn.setEnabled(False)
        
        scrolling_controls_row.addWidget(self.start_scrolling_btn)
        scrolling_controls_row.addWidget(self.stop_scrolling_btn)
        
        # Parallel profiles and cycle interval
        scrolling_controls_row.addWidget(QLabel("⚡ Параллельно профилей:"))
        self.parallel_profiles_input = QLineEdit("1")
        self.parallel_profiles_input.setMaximumWidth(60)
        scrolling_controls_row.addWidget(self.parallel_profiles_input)

        scrolling_controls_row.addWidget(QLabel("⌚ Цикличность Интервал:"))
        self.scrolling_cycle_input = QLineEdit("11 мин")
        self.scrolling_cycle_input.setMaximumWidth(80)
        scrolling_controls_row.addWidget(self.scrolling_cycle_input)
        scrolling_controls_row.addStretch()
        
        layout.addLayout(scrolling_controls_row)
        
        # === EXECUTION LOG SECTION ===
        log_group = QGroupBox("📋 Лог выполнения")
        log_layout = QVBoxLayout(log_group)
        
        self.threads_log_area = QTextEdit()
        self.threads_log_area.setObjectName("logArea")
        self.threads_log_area.setReadOnly(True)
        self.threads_log_area.setMaximumHeight(150)
        log_layout.addWidget(self.threads_log_area)
        
        layout.addWidget(log_group)
        
        # Add stretch at the end to push content to the top
        layout.addStretch()
        
        # Set the content widget to the scroll area
        scroll_area.setWidget(content_widget)
        
        # Add scroll area to the main layout
        main_layout.addWidget(scroll_area)

    def log(self, message):
        """Add message to Threads log"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.threads_log_area.append(f"[{timestamp}] {message}")
        scrollbar = self.threads_log_area.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())



    def start_scrolling(self):
        # Use private profiles only
        profiles = self.main_window.profile_manager.profiles.get("private", [])
        if not profiles:
             QMessageBox.warning(self, "Ошибка", "Нет созданных приватных профилей!")
             return

        # Convert private profiles to ThreadsAccount objects
        target_accounts = []
        for p in profiles:
            acc = ThreadsAccount(username=p["name"], password="", proxy=p.get("proxy"))
            target_accounts.append(acc)

        # Get activity types
        enable_feed = self.feed_checkbox.isChecked()
        enable_reels = self.reels_checkbox.isChecked()
        
        if not enable_feed and not enable_reels:
            QMessageBox.warning(self, "Ошибка", "Выберите хотя бы один тип активности (Лента или Reels)!")
            return

        self.save_settings()

        # Get action chances
        feed_like_chance = int(self.feed_likes_chance_slider.currentText().replace('%', ''))
        feed_carousel_watch_chance = int(self.feed_carousel_chance_slider.currentText().replace('%', ''))
        feed_follow_chance = int(self.feed_follows_chance_slider.currentText().replace('%', ''))
        reels_like_chance = int(self.reels_likes_chance_slider.currentText().replace('%', ''))
        reels_follow_chance = int(self.reels_follows_chance_slider.currentText().replace('%', ''))
        try:
            feed_carousel_max_slides = int(self.feed_carousel_max_input.text().split()[0])
        except:
            feed_carousel_max_slides = 3
        try:
            feed_stories_max = int(self.feed_stories_max_input.text().split()[0])
        except:
            feed_stories_max = 3
        comment_chance = 0  # Comments disabled/unsupported
        watch_stories = self.watch_stories_checkbox.isChecked()
        
        # Get time range (extract numbers from text like "1 мин")
        try:
            min_time = int(self.scroll_time_min_input.text().split()[0])
        except:
            min_time = 1
        
        try:
            max_time = int(self.scroll_time_max_input.text().split()[0])
        except:
            max_time = 3
        
        # Get cycle interval
        try:
            cycle_interval = int(self.scrolling_cycle_input.text().split()[0])
        except:
            cycle_interval = 11
        
        # Build config
        config = ScrollingConfig(
            use_private_profiles=True,
            use_threads_profiles=False,
            like_chance=feed_like_chance,
            comment_chance=comment_chance,
            follow_chance=feed_follow_chance,
            reels_like_chance=reels_like_chance,
            reels_follow_chance=reels_follow_chance,
            min_time_minutes=min_time,
            max_time_minutes=max_time,
            cycle_interval_minutes=cycle_interval,
            enable_feed=enable_feed,
            enable_reels=enable_reels,
            carousel_watch_chance=feed_carousel_watch_chance,
            carousel_max_slides=feed_carousel_max_slides,
            watch_stories=watch_stories,
            stories_max=feed_stories_max,
        )
        
        profile_names = [acc.username for acc in target_accounts]
        
        self.log(f"🔄 Запуск скроллинга для {len(target_accounts)} профилей...")
        
        self.worker = InstagramScrollingWorker(config, target_accounts, profile_names)
        self.worker.log_signal.connect(self.log)
        self.worker.finished_signal.connect(lambda: self.start_scrolling_btn.setEnabled(True))
        self.worker.finished_signal.connect(lambda: self.stop_scrolling_btn.setEnabled(False))
        
        self.start_scrolling_btn.setEnabled(False)
        self.stop_scrolling_btn.setEnabled(True)
        self.worker.start()

    def stop_scrolling(self):
        if self.worker:
            self.worker.stop()
            self.start_scrolling_btn.setEnabled(True)
            self.stop_scrolling_btn.setEnabled(False)

    def connect_settings_signals(self):
        """Persist settings whenever user changes controls."""
        for combo in [
            self.feed_likes_chance_slider,
            self.feed_carousel_chance_slider,
            self.feed_follows_chance_slider,
            self.reels_likes_chance_slider,
            self.reels_follows_chance_slider,
        ]:
            combo.currentIndexChanged.connect(self.save_settings)

        for checkbox in [
            self.feed_checkbox,
            self.reels_checkbox,
            self.watch_stories_checkbox,
        ]:
            checkbox.toggled.connect(self.save_settings)

        for line_edit in [
            self.scroll_time_min_input,
            self.scroll_time_max_input,
            self.scrolling_cycle_input,
            self.parallel_profiles_input,
            self.feed_carousel_max_input,
            self.feed_stories_max_input,
        ]:
            line_edit.editingFinished.connect(self.save_settings)

    def load_settings(self):
        """Load saved UI settings from disk."""
        defaults = {
            "use_private_profiles": False,
            "like_chance": 10,
            "carousel_watch_chance": 0,
            "follow_chance": 50,
            "reels_like_chance": 10,
            "reels_follow_chance": 50,
            "carousel_max_slides": 3,
            "stories_max": 3,
            "min_time_minutes": 1,
            "max_time_minutes": 3,
            "cycle_interval_minutes": 11,
            "enable_feed": True,
            "enable_reels": False,
            "parallel_profiles": 1,
            "watch_stories": True,
        }

        self.loading_settings = True
        data = defaults.copy()

        if self.settings_path.exists():
            try:
                loaded = json.loads(self.settings_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data.update(loaded)
            except Exception as e:
                print(f"Failed to load Instagram settings: {e}")

        def set_combo_value(combo: QComboBox, value: int):
            target = f"{value}%"
            idx = combo.findText(target)
            if idx != -1:
                combo.setCurrentIndex(idx)

        set_combo_value(self.feed_likes_chance_slider, data.get("like_chance", defaults["like_chance"]))
        set_combo_value(self.feed_carousel_chance_slider, data.get("carousel_watch_chance", defaults["carousel_watch_chance"]))
        set_combo_value(self.feed_follows_chance_slider, data.get("follow_chance", defaults["follow_chance"]))
        set_combo_value(self.reels_likes_chance_slider, data.get("reels_like_chance", defaults["reels_like_chance"]))
        set_combo_value(self.reels_follows_chance_slider, data.get("reels_follow_chance", defaults["reels_follow_chance"]))

        self.feed_checkbox.setChecked(data.get("enable_feed", True))
        self.reels_checkbox.setChecked(data.get("enable_reels", False))
        self.watch_stories_checkbox.setChecked(data.get("watch_stories", True))

        # Always use private profiles now

        self.scroll_time_min_input.setText(f"{data.get('min_time_minutes', defaults['min_time_minutes'])} мин")
        self.scroll_time_max_input.setText(f"{data.get('max_time_minutes', defaults['max_time_minutes'])} мин")
        self.scrolling_cycle_input.setText(f"{data.get('cycle_interval_minutes', defaults['cycle_interval_minutes'])} мин")
        self.parallel_profiles_input.setText(str(data.get("parallel_profiles", defaults["parallel_profiles"])))
        self.feed_carousel_max_input.setText(str(data.get("carousel_max_slides", defaults["carousel_max_slides"])))
        self.feed_stories_max_input.setText(str(data.get("stories_max", defaults["stories_max"])))

        self.loading_settings = False

    def save_settings(self):
        """Save current UI settings to disk."""
        if self.loading_settings:
            return

        def parse_int_field(field: QLineEdit, default: int) -> int:
            try:
                return int(field.text().split()[0])
            except Exception:
                return default

        payload = {
            "use_private_profiles": True,  # Always use private profiles now
            "like_chance": int(self.feed_likes_chance_slider.currentText().replace('%', '')),
            "carousel_watch_chance": int(self.feed_carousel_chance_slider.currentText().replace('%', '')),
            "follow_chance": int(self.feed_follows_chance_slider.currentText().replace('%', '')),
            "reels_like_chance": int(self.reels_likes_chance_slider.currentText().replace('%', '')),
            "reels_follow_chance": int(self.reels_follows_chance_slider.currentText().replace('%', '')),
            "carousel_max_slides": parse_int_field(self.feed_carousel_max_input, 3),
            "stories_max": parse_int_field(self.feed_stories_max_input, 3),
            "min_time_minutes": parse_int_field(self.scroll_time_min_input, 1),
            "max_time_minutes": parse_int_field(self.scroll_time_max_input, 3),
            "cycle_interval_minutes": parse_int_field(self.scrolling_cycle_input, 11),
            "enable_feed": self.feed_checkbox.isChecked(),
            "enable_reels": self.reels_checkbox.isChecked(),
            "parallel_profiles": parse_int_field(self.parallel_profiles_input, 1),
            "watch_stories": self.watch_stories_checkbox.isChecked(),
        }

        try:
            self.settings_path.write_text(json.dumps(payload, indent=4, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"Failed to save Instagram settings: {e}")
