import json
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QPushButton, QLabel,
    QGroupBox, QMessageBox, QScrollArea, QFrame, QRadioButton, QButtonGroup,
    QLineEdit, QComboBox, QTextEdit, QCheckBox, QGridLayout, QSizePolicy,
    QDialog
)
from PyQt6.QtCore import Qt, QSize
from PyQt6.QtGui import QFont, QColor, QIcon
from datetime import datetime
from core.models import ThreadsAccount, ScrollingConfig
from gui.workers.instagram_worker import InstagramScrollingWorker
from gui.styles import (
    CARD_STYLE, STATUS_RUNNING, STATUS_IDLE, STATUS_STOPPED,
    BUTTON_STYLE, ACTION_BTN_STYLE, PRIMARY_BTN_STYLE, INPUT_STYLE,
    CHECKBOX_STYLE, DIALOG_STYLE
)

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

class InstagramTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self.worker = None
        self.settings_path = Path(__file__).resolve().parents[2] / "instagram_settings.json"
        self.loading_settings = False
        self.is_running = False
        
        # Initialize dialogs
        self.feed_settings_dialog = None
        self.reels_settings_dialog = None
        
        self.setup_ui()
        self.load_settings()
        self.connect_settings_signals()

    def setup_ui(self):
        # Apply strict background to match other tabs
        # self.setStyleSheet("background-color: #1e2125;")

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(30, 30, 30, 30)
        main_layout.setSpacing(25)

        # === 1. HEADER SECTION ===
        header_layout = QHBoxLayout()
        
        # Title
        title_widget = QWidget()
        title_layout = QVBoxLayout(title_widget)
        title_layout.setContentsMargins(0, 0, 0, 0)
        title_layout.setSpacing(5)
        
        title_label = QLabel("Instagram Автоматизация")
        title_label.setStyleSheet("color: white; font-size: 28px; font-weight: bold;")
        subtitle_label = QLabel("Управление активностью и скроллинг ленты")
        subtitle_label.setStyleSheet("color: #abb2bf; font-size: 14px;")
        
        title_layout.addWidget(title_label)
        title_layout.addWidget(subtitle_label)
        header_layout.addWidget(title_widget)
        
        header_layout.addStretch()

        # --- RUNTIME SETTINGS (Header) ---
        settings_container = QWidget()
        settings_layout = QHBoxLayout(settings_container)
        settings_layout.setContentsMargins(0, 0, 0, 0)
        settings_layout.setSpacing(15)

        # Helper to create compact header inputs
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

        # Time Range
        time_container = QWidget()
        time_layout = QVBoxLayout(time_container)
        time_layout.setContentsMargins(0, 0, 0, 0)
        time_layout.setSpacing(2)
        time_lbl = QLabel("⏱️ Мин-Макс (мин)")
        time_lbl.setStyleSheet("color: #abb2bf; font-size: 11px; font-weight: bold;")
        
        time_inputs = QHBoxLayout()
        time_inputs.setSpacing(5)
        self.scroll_time_min_input = QLineEdit("1")
        self.scroll_time_min_input.setStyleSheet(INPUT_STYLE + "QLineEdit { background: transparent; padding: 4px; font-size: 12px; }")
        self.scroll_time_min_input.setFixedWidth(30)
        self.scroll_time_max_input = QLineEdit("3")
        self.scroll_time_max_input.setStyleSheet(INPUT_STYLE + "QLineEdit { background: transparent; padding: 4px; font-size: 12px; }")
        self.scroll_time_max_input.setFixedWidth(30)
        
        time_inputs.addWidget(self.scroll_time_min_input)
        time_inputs.addWidget(QLabel("-"))
        time_inputs.addWidget(self.scroll_time_max_input)
        
        time_layout.addWidget(time_lbl)
        time_layout.addLayout(time_inputs)
        settings_layout.addWidget(time_container)

        # Cycle Interval
        cycle_widget, self.scrolling_cycle_input = create_header_input("🕓 Цикл (мин)", "11", 60)
        settings_layout.addWidget(cycle_widget)

        # Threads
        threads_widget, self.parallel_profiles_input = create_header_input("⚡ Потоки", "1", 40)
        settings_layout.addWidget(threads_widget)

        header_layout.addWidget(settings_container)

        # Global Actions (Single Toggle Button)
        self.action_btn = QPushButton("▶ Запустить")
        self.action_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.action_btn.setMinimumWidth(150)
        self.action_btn.clicked.connect(self.toggle_scrolling)
        
        # Set initial style (Start)
        self.update_action_button_state(running=False)

        header_layout.addWidget(self.action_btn)
        main_layout.addLayout(header_layout)

        # === 2. SCROLLABLE CONTENT ===
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        scroll_area.setStyleSheet("""
            QScrollArea { background: transparent; border: none; }
            QScrollBar:vertical {
                border: none;
                background: #2b2d30;
                width: 8px;
                border-radius: 4px;
            }
            QScrollBar::handle:vertical {
                background: #4b4d50;
                border-radius: 4px;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
        """)

        content_widget = QWidget()
        content_widget.setStyleSheet("background: transparent;")
        content_layout = QVBoxLayout(content_widget)
        content_layout.setSpacing(20)
        content_layout.setContentsMargins(0, 0, 10, 0) # Right margin for scrollbar

        # --- SECTION: Target & Activity ---
        target_card = QFrame()
        target_card.setStyleSheet(CARD_STYLE)
        target_layout = QVBoxLayout(target_card)
        target_layout.setContentsMargins(20, 20, 20, 20)
        target_layout.setSpacing(15)

        # Header
        t_header = QLabel("🎯 Цель и Активность")
        t_header.setStyleSheet("color: #e0e0e0; font-weight: bold; font-size: 16px; border: none;")
        target_layout.addWidget(t_header)

        # Content Grid
        t_grid = QGridLayout()
        t_grid.setHorizontalSpacing(30)
        t_grid.setVerticalSpacing(15)

        # Row 1: Profile Source
        t_grid.addWidget(QLabel("Источник профилей:"), 0, 0)
        source_label = QLabel("📂 Приватные профили")
        source_label.setStyleSheet("color: #61afef; font-weight: bold; font-size: 14px;")
        t_grid.addWidget(source_label, 0, 1)

        # Row 2: Checkboxes with Settings Buttons
        t_grid.addWidget(QLabel("Режим работы:"), 1, 0)
        
        checks_layout = QHBoxLayout()
        checks_layout.setSpacing(20)
        
        # Feed Checkbox + Settings
        feed_container = QWidget()
        feed_layout = QHBoxLayout(feed_container)
        feed_layout.setContentsMargins(0, 0, 0, 0)
        feed_layout.setSpacing(5)
        
        self.feed_checkbox = QCheckBox("Лента (Feed)")
        self.feed_checkbox.setStyleSheet(CHECKBOX_STYLE)
        self.feed_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        
        self.feed_settings_btn = QPushButton("⚙")
        self.feed_settings_btn.setToolTip("Настройки")
        self.feed_settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.feed_settings_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #abb2bf;")
        self.feed_settings_btn.clicked.connect(self.open_feed_settings)
        
        feed_layout.addWidget(self.feed_checkbox)
        feed_layout.addWidget(self.feed_settings_btn)
        
        # Reels Checkbox + Settings
        reels_container = QWidget()
        reels_layout = QHBoxLayout(reels_container)
        reels_layout.setContentsMargins(0, 0, 0, 0)
        reels_layout.setSpacing(5)
        
        self.reels_checkbox = QCheckBox("Reels")
        self.reels_checkbox.setStyleSheet(CHECKBOX_STYLE)
        self.reels_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        
        self.reels_settings_btn = QPushButton("⚙")
        self.reels_settings_btn.setToolTip("Настройки")
        self.reels_settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.reels_settings_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #abb2bf;")
        self.reels_settings_btn.clicked.connect(self.open_reels_settings)
        
        reels_layout.addWidget(self.reels_checkbox)
        reels_layout.addWidget(self.reels_settings_btn)
        
        checks_layout.addWidget(feed_container)
        checks_layout.addWidget(reels_container)
        checks_layout.addStretch()
        
        t_grid.addLayout(checks_layout, 1, 1)

        target_layout.addLayout(t_grid)
        content_layout.addWidget(target_card)

        # Initialize Settings Widgets (and add to Dialogs internally)
        self.init_settings_widgets()

        # Push content up
        content_layout.addStretch()

        scroll_area.setWidget(content_widget)
        main_layout.addWidget(scroll_area)

        # === 3. LOG SECTION ===
        log_frame = QFrame()
        log_frame.setStyleSheet("""
            QFrame {
                background-color: #21252b;
                border: 1px solid #3e4042;
                border-radius: 8px;
            }
        """)
        log_layout = QVBoxLayout(log_frame)
        log_layout.setContentsMargins(1, 1, 1, 1)
        
        self.threads_log_area = QTextEdit()
        self.threads_log_area.setReadOnly(True)
        self.threads_log_area.setPlaceholderText("Лог выполнения появится здесь...")
        self.threads_log_area.setMaximumHeight(150)
        self.threads_log_area.setStyleSheet("""
            QTextEdit {
                background-color: #21252b;
                border: none;
                color: #abb2bf;
                padding: 10px;
                font-family: 'Consolas', monospace;
                font-size: 12px;
            }
        """)
        log_layout.addWidget(self.threads_log_area)
        
        main_layout.addWidget(log_frame)

    def init_settings_widgets(self):
        """Initialize settings widgets and dialogs, keeping them in memory."""
        percent_options = [f"{i}%" for i in range(0, 101, 10)]
        
        # --- FEED SETTINGS DIALOG ---
        self.feed_settings_dialog = SettingsDialog("Настройки ленты", self)
        
        # Watch Stories
        self.watch_stories_checkbox = QCheckBox("Смотреть Stories")
        self.watch_stories_checkbox.setStyleSheet(CHECKBOX_STYLE)
        self.watch_stories_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.feed_settings_dialog.add_widget(self.watch_stories_checkbox)

        # Feed Likes
        f_likes_layout = QHBoxLayout()
        f_likes_layout.addWidget(QLabel("❤️ Лайки:"))
        self.feed_likes_chance_slider = QComboBox()
        self.feed_likes_chance_slider.addItems(percent_options)
        self.feed_likes_chance_slider.setStyleSheet(INPUT_STYLE)
        self.feed_likes_chance_slider.setFixedWidth(80)
        f_likes_layout.addWidget(self.feed_likes_chance_slider)
        self.feed_settings_dialog.add_layout(f_likes_layout)

        # Feed Follows
        f_follows_layout = QHBoxLayout()
        f_follows_layout.addWidget(QLabel("➕ Подписки:"))
        self.feed_follows_chance_slider = QComboBox()
        self.feed_follows_chance_slider.addItems(percent_options)
        self.feed_follows_chance_slider.setStyleSheet(INPUT_STYLE)
        self.feed_follows_chance_slider.setFixedWidth(80)
        f_follows_layout.addWidget(self.feed_follows_chance_slider)
        self.feed_settings_dialog.add_layout(f_follows_layout)

        # Carousel Watch
        f_carousel_layout = QHBoxLayout()
        f_carousel_layout.addWidget(QLabel("🖼️ Карусели:"))
        self.feed_carousel_chance_slider = QComboBox()
        self.feed_carousel_chance_slider.addItems(percent_options)
        self.feed_carousel_chance_slider.setStyleSheet(INPUT_STYLE)
        self.feed_carousel_chance_slider.setFixedWidth(80)
        f_carousel_layout.addWidget(self.feed_carousel_chance_slider)
        self.feed_settings_dialog.add_layout(f_carousel_layout)

        # Carousel Max
        f_cmax_layout = QHBoxLayout()
        f_cmax_layout.addWidget(QLabel("   ↳ Макс слайдов:"))
        self.feed_carousel_max_input = QLineEdit("3")
        self.feed_carousel_max_input.setStyleSheet(INPUT_STYLE)
        self.feed_carousel_max_input.setFixedWidth(60)
        f_cmax_layout.addWidget(self.feed_carousel_max_input)
        self.feed_settings_dialog.add_layout(f_cmax_layout)

        # Stories Max
        f_smax_layout = QHBoxLayout()
        f_smax_layout.addWidget(QLabel("👀 Макс сторис:"))
        self.feed_stories_max_input = QLineEdit("3")
        self.feed_stories_max_input.setStyleSheet(INPUT_STYLE)
        self.feed_stories_max_input.setFixedWidth(60)
        f_smax_layout.addWidget(self.feed_stories_max_input)
        self.feed_settings_dialog.add_layout(f_smax_layout)
        
        # --- REELS SETTINGS DIALOG ---
        self.reels_settings_dialog = SettingsDialog("Настройки Reels", self)

        # Reels Likes
        r_likes_layout = QHBoxLayout()
        r_likes_layout.addWidget(QLabel("❤️ Лайки (Reels):"))
        self.reels_likes_chance_slider = QComboBox()
        self.reels_likes_chance_slider.addItems(percent_options)
        self.reels_likes_chance_slider.setStyleSheet(INPUT_STYLE)
        self.reels_likes_chance_slider.setFixedWidth(80)
        r_likes_layout.addWidget(self.reels_likes_chance_slider)
        self.reels_settings_dialog.add_layout(r_likes_layout)

        # Reels Follows
        r_follows_layout = QHBoxLayout()
        r_follows_layout.addWidget(QLabel("➕ Подписки (Reels):"))
        self.reels_follows_chance_slider = QComboBox()
        self.reels_follows_chance_slider.addItems(percent_options)
        self.reels_follows_chance_slider.setStyleSheet(INPUT_STYLE)
        self.reels_follows_chance_slider.setFixedWidth(80)
        r_follows_layout.addWidget(self.reels_follows_chance_slider)
        self.reels_settings_dialog.add_layout(r_follows_layout)

    def open_feed_settings(self):
        self.feed_settings_dialog.exec()

    def open_reels_settings(self):
        self.reels_settings_dialog.exec()

    def log(self, message):
        """Add message to Threads log"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.threads_log_area.append(f"[{timestamp}] {message}")
        scrollbar = self.threads_log_area.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())

    def toggle_scrolling(self):
        """Toggle between start and stop based on state"""
        if self.is_running:
            self.stop_scrolling()
        else:
            self.start_scrolling()

    def update_action_button_state(self, running):
        """Update the action button appearance based on state"""
        if running:
            # STOP Style
            self.action_btn.setText("⏹ Остановить")
            self.action_btn.setStyleSheet("""
                QPushButton {
                    background-color: rgba(224, 108, 117, 0.2);
                    color: #e06c75;
                    border: 1px solid #e06c75;
                    border-radius: 8px;
                    padding: 10px 20px;
                    font-size: 14px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background-color: rgba(224, 108, 117, 0.3);
                }
            """)
        else:
            # START Style
            self.action_btn.setText("▶ Запустить")
            self.action_btn.setStyleSheet("""
                QPushButton {
                    background-color: rgba(97, 175, 239, 0.2);
                    color: #61afef;
                    border: 1px solid #61afef;
                    border-radius: 8px;
                    padding: 10px 20px;
                    font-size: 14px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background-color: rgba(97, 175, 239, 0.3);
                }
            """)

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
        self.worker.finished_signal.connect(self.on_worker_finished)
        
        self.is_running = True
        self.update_action_button_state(running=True)
        self.worker.start()

    def on_worker_finished(self):
        self.log("✅ Задача выполнена")
        self.is_running = False
        self.update_action_button_state(running=False)

    def stop_scrolling(self):
        if self.worker:
            self.worker.stop()
            self.log("⚠️ Остановка...")
            # Button will clear when worker finishes
            self.action_btn.setText("Останавливаем...")
            self.action_btn.setEnabled(False)

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

        self.scroll_time_min_input.setText(f"{data.get('min_time_minutes', defaults['min_time_minutes'])}")
        self.scroll_time_max_input.setText(f"{data.get('max_time_minutes', defaults['max_time_minutes'])}")
        self.scrolling_cycle_input.setText(f"{data.get('cycle_interval_minutes', defaults['cycle_interval_minutes'])}")
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
