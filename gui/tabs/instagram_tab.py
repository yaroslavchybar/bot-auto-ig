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
from gui.workers.follow_worker import AutoFollowWorker
from gui.workers.unfollow_worker import UnfollowWorker
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
        self.follow_worker = None
        self.unfollow_worker = None
        self.settings_path = Path(__file__).resolve().parents[2] / "instagram_settings.json"
        self.follow_settings_path = Path(__file__).resolve().parents[2] / "follow_settings.json"
        self.unfollow_settings_path = Path(__file__).resolve().parents[2] / "unfollow_settings.json"
        self.loading_settings = False
        self.is_running = False
        
        # Initialize dialogs
        self.feed_settings_dialog = None
        self.reels_settings_dialog = None
        self.follow_settings_dialog = None
        self.unfollow_settings_dialog = None
        self.approve_settings_dialog = None
        self.message_settings_dialog = None
        
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
        
        # Follow Checkbox + Settings
        follow_container = QWidget()
        follow_layout = QHBoxLayout(follow_container)
        follow_layout.setContentsMargins(0, 0, 0, 0)
        follow_layout.setSpacing(5)
        
        self.follow_checkbox = QCheckBox("Подписки (Follow)")
        self.follow_checkbox.setStyleSheet(CHECKBOX_STYLE)
        self.follow_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        
        self.follow_settings_btn = QPushButton("⚙")
        self.follow_settings_btn.setToolTip("Настройки")
        self.follow_settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.follow_settings_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #abb2bf;")
        self.follow_settings_btn.clicked.connect(self.open_follow_settings)
        
        follow_layout.addWidget(self.follow_checkbox)
        follow_layout.addWidget(self.follow_settings_btn)

        checks_layout.addWidget(feed_container)
        checks_layout.addWidget(reels_container)
        checks_layout.addWidget(follow_container)
        checks_layout.addStretch()
        
        t_grid.addLayout(checks_layout, 1, 1)

        # Row 3: Additional Tools (Unfollow, Approve, Message)
        checks_layout_2 = QHBoxLayout()
        checks_layout_2.setSpacing(20)
        
        # Unfollow
        unfollow_container = QWidget()
        unfollow_layout = QHBoxLayout(unfollow_container)
        unfollow_layout.setContentsMargins(0, 0, 0, 0)
        unfollow_layout.setSpacing(5)
        self.unfollow_checkbox = QCheckBox("Unfollow")
        self.unfollow_checkbox.setStyleSheet(CHECKBOX_STYLE)
        self.unfollow_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.unfollow_settings_btn = QPushButton("⚙")
        self.unfollow_settings_btn.setToolTip("Настройки")
        self.unfollow_settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.unfollow_settings_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #abb2bf;")
        self.unfollow_settings_btn.clicked.connect(self.open_unfollow_settings)
        unfollow_layout.addWidget(self.unfollow_checkbox)
        unfollow_layout.addWidget(self.unfollow_settings_btn)
        
        # Approve
        approve_container = QWidget()
        approve_layout = QHBoxLayout(approve_container)
        approve_layout.setContentsMargins(0, 0, 0, 0)
        approve_layout.setSpacing(5)
        self.approve_checkbox = QCheckBox("Approve")
        self.approve_checkbox.setStyleSheet(CHECKBOX_STYLE)
        self.approve_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.approve_settings_btn = QPushButton("⚙")
        self.approve_settings_btn.setToolTip("Настройки")
        self.approve_settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.approve_settings_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #abb2bf;")
        self.approve_settings_btn.clicked.connect(self.open_approve_settings)
        approve_layout.addWidget(self.approve_checkbox)
        approve_layout.addWidget(self.approve_settings_btn)

        # Message
        message_container = QWidget()
        message_layout = QHBoxLayout(message_container)
        message_layout.setContentsMargins(0, 0, 0, 0)
        message_layout.setSpacing(5)
        self.message_checkbox = QCheckBox("Message")
        self.message_checkbox.setStyleSheet(CHECKBOX_STYLE)
        self.message_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.message_settings_btn = QPushButton("⚙")
        self.message_settings_btn.setToolTip("Настройки")
        self.message_settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.message_settings_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #abb2bf;")
        self.message_settings_btn.clicked.connect(self.open_message_settings)
        message_layout.addWidget(self.message_checkbox)
        message_layout.addWidget(self.message_settings_btn)
        
        checks_layout_2.addWidget(unfollow_container)
        checks_layout_2.addWidget(approve_container)
        checks_layout_2.addWidget(message_container)
        checks_layout_2.addStretch()

        t_grid.addLayout(checks_layout_2, 2, 1)

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

        # Feed Time Range
        f_time_layout = QHBoxLayout()
        f_time_layout.addWidget(QLabel("⏱️ Мин-Макс время (мин):"))
        self.feed_time_min_input = QLineEdit("1")
        self.feed_time_min_input.setStyleSheet(INPUT_STYLE)
        self.feed_time_min_input.setFixedWidth(50)
        self.feed_time_max_input = QLineEdit("3")
        self.feed_time_max_input.setStyleSheet(INPUT_STYLE)
        self.feed_time_max_input.setFixedWidth(50)
        f_time_layout.addWidget(self.feed_time_min_input)
        f_time_layout.addWidget(QLabel("-"))
        f_time_layout.addWidget(self.feed_time_max_input)
        self.feed_settings_dialog.add_layout(f_time_layout)

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

        # Reels Time Range
        r_time_layout = QHBoxLayout()
        r_time_layout.addWidget(QLabel("⏱️ Мин-Макс время (мин):"))
        self.reels_time_min_input = QLineEdit("1")
        self.reels_time_min_input.setStyleSheet(INPUT_STYLE)
        self.reels_time_min_input.setFixedWidth(50)
        self.reels_time_max_input = QLineEdit("3")
        self.reels_time_max_input.setStyleSheet(INPUT_STYLE)
        self.reels_time_max_input.setFixedWidth(50)
        r_time_layout.addWidget(self.reels_time_min_input)
        r_time_layout.addWidget(QLabel("-"))
        r_time_layout.addWidget(self.reels_time_max_input)
        self.reels_settings_dialog.add_layout(r_time_layout)

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

        # --- FOLLOW SETTINGS DIALOG ---
        self.follow_settings_dialog = SettingsDialog("Настройки подписки", self)
        
        # Highlights
        h_row = QHBoxLayout()
        h_row.addWidget(QLabel("Хайлайты на аккаунт:"))
        self.highlights_min_input = QLineEdit("2")
        self.highlights_min_input.setStyleSheet(INPUT_STYLE)
        self.highlights_min_input.setFixedWidth(50)
        self.highlights_max_input = QLineEdit("4")
        self.highlights_max_input.setStyleSheet(INPUT_STYLE)
        self.highlights_max_input.setFixedWidth(50)
        h_row.addWidget(self.highlights_min_input)
        h_row.addWidget(QLabel("-"))
        h_row.addWidget(self.highlights_max_input)
        self.follow_settings_dialog.add_layout(h_row)

        # Likes
        l_row = QHBoxLayout()
        l_row.addWidget(QLabel("Лайков на аккаунт:"))
        self.likes_min_input = QLineEdit("1")
        self.likes_min_input.setStyleSheet(INPUT_STYLE)
        self.likes_min_input.setFixedWidth(50)
        self.likes_max_input = QLineEdit("2")
        self.likes_max_input.setStyleSheet(INPUT_STYLE)
        self.likes_max_input.setFixedWidth(50)
        l_row.addWidget(self.likes_min_input)
        l_row.addWidget(QLabel("-"))
        l_row.addWidget(self.likes_max_input)
        self.follow_settings_dialog.add_layout(l_row)

        # Follow Limit
        fl_row = QHBoxLayout()
        fl_row.addWidget(QLabel("Макс. подписок у цели:"))
        self.following_limit_input = QLineEdit("3000")
        self.following_limit_input.setStyleSheet(INPUT_STYLE)
        self.following_limit_input.setFixedWidth(80)
        fl_row.addWidget(self.following_limit_input)
        self.follow_settings_dialog.add_layout(fl_row)

        # --- UNFOLLOW SETTINGS DIALOG ---
        self.unfollow_settings_dialog = SettingsDialog("Настройки отписки", self)
        
        uf_delay_layout = QHBoxLayout()
        uf_delay_layout.addWidget(QLabel("⏱️ Задержка (сек):"))
        self.unfollow_min_delay_input = QLineEdit("10")
        self.unfollow_min_delay_input.setStyleSheet(INPUT_STYLE)
        self.unfollow_min_delay_input.setFixedWidth(50)
        self.unfollow_max_delay_input = QLineEdit("30")
        self.unfollow_max_delay_input.setStyleSheet(INPUT_STYLE)
        self.unfollow_max_delay_input.setFixedWidth(50)
        uf_delay_layout.addWidget(self.unfollow_min_delay_input)
        uf_delay_layout.addWidget(QLabel("-"))
        uf_delay_layout.addWidget(self.unfollow_max_delay_input)
        self.unfollow_settings_dialog.add_layout(uf_delay_layout)

        # --- APPROVE SETTINGS DIALOG ---
        self.approve_settings_dialog = SettingsDialog("Настройки подтверждения", self)
        self.approve_settings_dialog.add_widget(QLabel("Нет доступных настроек для подтверждения заявок.\nПроцесс выполняется автоматически."))

        # --- MESSAGE SETTINGS DIALOG ---
        self.message_settings_dialog = SettingsDialog("Настройки рассылки", self)
        
        self.message_settings_dialog.add_widget(QLabel("Текст сообщения (message.txt):"))
        self.message_text_edit = QTextEdit()
        self.message_text_edit.setStyleSheet(INPUT_STYLE)
        self.message_text_edit.setMinimumHeight(150)
        self.message_settings_dialog.add_widget(self.message_text_edit)
        
        save_msg_btn = QPushButton("💾 Сохранить текст")
        save_msg_btn.setStyleSheet(PRIMARY_BTN_STYLE)
        save_msg_btn.clicked.connect(self.save_message_text)
        self.message_settings_dialog.add_widget(save_msg_btn)

    def open_feed_settings(self):
        self.feed_settings_dialog.exec()

    def open_reels_settings(self):
        self.reels_settings_dialog.exec()

    def open_follow_settings(self):
        self.follow_settings_dialog.exec()

    def open_unfollow_settings(self):
        self.unfollow_settings_dialog.exec()

    def open_approve_settings(self):
        self.approve_settings_dialog.exec()

    def open_message_settings(self):
        # Load message.txt content when opening
        try:
            msg_path = Path("message.txt")
            if msg_path.exists():
                content = msg_path.read_text(encoding="utf-8")
                self.message_text_edit.setPlainText(content)
            else:
                self.message_text_edit.setPlainText("")
        except Exception as e:
            self.log(f"Ошибка чтения message.txt: {e}")
        self.message_settings_dialog.exec()
        
    def save_message_text(self):
        try:
            content = self.message_text_edit.toPlainText()
            Path("message.txt").write_text(content, encoding="utf-8")
            QMessageBox.information(self, "Успешно", "Текст сообщения сохранен в message.txt")
        except Exception as e:
            QMessageBox.critical(self, "Ошибка", f"Не удалось сохранить message.txt: {e}")

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
            self.action_btn.setEnabled(True)  # Re-enable button when not running
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
        # 1. Determine what to run
        enable_feed = self.feed_checkbox.isChecked()
        enable_reels = self.reels_checkbox.isChecked()
        enable_follow = self.follow_checkbox.isChecked()
        enable_unfollow = self.unfollow_checkbox.isChecked()
        enable_approve = self.approve_checkbox.isChecked()
        enable_message = self.message_checkbox.isChecked()
        
        if not any([enable_feed, enable_reels, enable_follow, enable_unfollow, enable_approve, enable_message]):
            QMessageBox.warning(self, "Ошибка", "Выберите хотя бы один тип активности!")
            return

        self.save_settings()
        self.is_running = True
        self.update_action_button_state(running=True)

        # 2. Start Follow Worker if enabled
        if enable_follow:
            try:
                highlights_min = int(self.highlights_min_input.text().split()[0])
            except:
                highlights_min = 2
            try:
                highlights_max = int(self.highlights_max_input.text().split()[0])
            except:
                highlights_max = 4
            
            try:
                likes_min = int(self.likes_min_input.text().split()[0])
            except:
                likes_min = 1
            try:
                likes_max = int(self.likes_max_input.text().split()[0])
            except:
                likes_max = 2
                
            try:
                following_limit = int(self.following_limit_input.text().split()[0])
            except:
                following_limit = 3000

            highlights_range = (highlights_min, highlights_max)
            likes_range = (likes_min, likes_max)

            self.follow_worker = AutoFollowWorker(
                highlights_range=highlights_range,
                likes_range=likes_range,
                following_limit=following_limit,
            )
            self.follow_worker.log_signal.connect(self.log)
            self.follow_worker.finished_signal.connect(self.on_follow_finished)
            self.follow_worker.start()
            self.log("▶️ Запуск автоподписки...")

        # 3. Start Unfollow/Approve/Message Worker if enabled
        if enable_unfollow or enable_approve or enable_message:
            try:
                uf_min = int(self.unfollow_min_delay_input.text().split()[0])
            except:
                uf_min = 10
            try:
                uf_max = int(self.unfollow_max_delay_input.text().split()[0])
            except:
                uf_max = 30
            
            if uf_min > uf_max:
                uf_min, uf_max = uf_max, uf_min
                self.unfollow_min_delay_input.setText(str(uf_min))
                self.unfollow_max_delay_input.setText(str(uf_max))

            self.unfollow_worker = UnfollowWorker(
                delay_range=(uf_min, uf_max),
                do_unfollow=enable_unfollow,
                do_approve=enable_approve,
                do_message=enable_message
            )
            self.unfollow_worker.log_signal.connect(self.log)
            self.unfollow_worker.finished_signal.connect(self.on_unfollow_finished)
            self.unfollow_worker.start()
            
            tasks = []
            if enable_unfollow: tasks.append("Отписка")
            if enable_approve: tasks.append("Подтверждение")
            if enable_message: tasks.append("Рассылка")
            self.log(f"▶️ Запуск задач: {', '.join(tasks)}...")

        # 4. Start Scrolling Worker if enabled
        if enable_feed or enable_reels:
            # Use private profiles only
            profiles = self.main_window.profile_manager.profiles.get("private", [])
            if not profiles:
                 if not enable_follow and not (enable_unfollow or enable_approve or enable_message):
                    QMessageBox.warning(self, "Ошибка", "Нет созданных приватных профилей для скроллинга!")
                    self.is_running = False
                    self.update_action_button_state(running=False)
                    return
                 elif not (enable_unfollow or enable_approve or enable_message):
                    self.log("⚠️ Нет приватных профилей для скроллинга, работает только подписка.")
            else:
                # Convert private profiles to ThreadsAccount objects
                target_accounts = []
                for p in profiles:
                    acc = ThreadsAccount(username=p["name"], password="", proxy=p.get("proxy"))
                    target_accounts.append(acc)

                # Get action chances and config
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
                
                # Get time ranges
                try:
                    feed_min_time = int(self.feed_time_min_input.text().split()[0])
                except:
                    feed_min_time = 1
                try:
                    feed_max_time = int(self.feed_time_max_input.text().split()[0])
                except:
                    feed_max_time = 3
                try:
                    reels_min_time = int(self.reels_time_min_input.text().split()[0])
                except:
                    reels_min_time = 1
                try:
                    reels_max_time = int(self.reels_time_max_input.text().split()[0])
                except:
                    reels_max_time = 3
                
                try:
                    cycle_interval = int(self.scrolling_cycle_input.text().split()[0])
                except:
                    cycle_interval = 11
                
                config = ScrollingConfig(
                    use_private_profiles=True,
                    use_threads_profiles=False,
                    like_chance=feed_like_chance,
                    comment_chance=0,
                    follow_chance=feed_follow_chance,
                    reels_like_chance=reels_like_chance,
                    reels_follow_chance=reels_follow_chance,
                    min_time_minutes=feed_min_time,
                    max_time_minutes=feed_max_time,
                    feed_min_time_minutes=feed_min_time,
                    feed_max_time_minutes=feed_max_time,
                    reels_min_time_minutes=reels_min_time,
                    reels_max_time_minutes=reels_max_time,
                    cycle_interval_minutes=cycle_interval,
                    enable_feed=enable_feed,
                    enable_reels=enable_reels,
                    carousel_watch_chance=feed_carousel_watch_chance,
                    carousel_max_slides=feed_carousel_max_slides,
                    watch_stories=self.watch_stories_checkbox.isChecked(),
                    stories_max=feed_stories_max,
                )
                
                profile_names = [acc.username for acc in target_accounts]
                self.log(f"🔄 Запуск скроллинга для {len(target_accounts)} профилей...")
                
                self.worker = InstagramScrollingWorker(config, target_accounts, profile_names)
                self.worker.log_signal.connect(self.log)
                self.worker.finished_signal.connect(self.on_worker_finished)
                self.worker.start()

    def on_worker_finished(self):
        self.log("✅ Скроллинг остановлен/завершен")
        self.check_all_finished()

    def on_follow_finished(self):
        self.log("✅ Автоподписка завершена")
        self.check_all_finished()
        
    def on_unfollow_finished(self):
        self.log("✅ Задачи (Unfollow/Approve/Message) завершены")
        self.check_all_finished()

    def check_all_finished(self):
        scrolling_active = self.worker and self.worker.isRunning()
        follow_active = self.follow_worker and self.follow_worker.isRunning()
        unfollow_active = self.unfollow_worker and self.unfollow_worker.isRunning()
        
        if not scrolling_active and not follow_active and not unfollow_active:
            self.is_running = False
            self.update_action_button_state(running=False)

    def stop_scrolling(self):
        self.log("⏹️ Остановка всех задач...")
        if self.worker:
            self.worker.stop()
        if self.follow_worker:
            self.follow_worker.stop()
        if self.unfollow_worker:
            self.unfollow_worker.stop()
            
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
            self.follow_checkbox,
            self.watch_stories_checkbox,
            self.unfollow_checkbox,
            self.approve_checkbox,
            self.message_checkbox,
        ]:
            checkbox.toggled.connect(self.save_settings)

        for line_edit in [
            self.feed_time_min_input,
            self.feed_time_max_input,
            self.reels_time_min_input,
            self.reels_time_max_input,
            self.scrolling_cycle_input,
            self.parallel_profiles_input,
            self.feed_carousel_max_input,
            self.feed_stories_max_input,
            self.highlights_min_input,
            self.highlights_max_input,
            self.likes_min_input,
            self.likes_max_input,
            self.following_limit_input,
            self.unfollow_min_delay_input,
            self.unfollow_max_delay_input,
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
            "feed_min_time_minutes": 1,
            "feed_max_time_minutes": 3,
            "reels_min_time_minutes": 1,
            "reels_max_time_minutes": 3,
            "cycle_interval_minutes": 11,
            "enable_feed": True,
            "enable_reels": False,
            "enable_follow": False,
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
        self.follow_checkbox.setChecked(data.get("enable_follow", False))
        self.watch_stories_checkbox.setChecked(data.get("watch_stories", True))

        self.feed_time_min_input.setText(str(data.get('feed_min_time_minutes', defaults['feed_min_time_minutes'])))
        self.feed_time_max_input.setText(str(data.get('feed_max_time_minutes', defaults['feed_max_time_minutes'])))
        self.reels_time_min_input.setText(str(data.get('reels_min_time_minutes', defaults['reels_min_time_minutes'])))
        self.reels_time_max_input.setText(str(data.get('reels_max_time_minutes', defaults['reels_max_time_minutes'])))
        self.scrolling_cycle_input.setText(f"{data.get('cycle_interval_minutes', defaults['cycle_interval_minutes'])}")
        self.parallel_profiles_input.setText(str(data.get("parallel_profiles", defaults["parallel_profiles"])))
        self.feed_carousel_max_input.setText(str(data.get("carousel_max_slides", defaults["carousel_max_slides"])))
        self.feed_stories_max_input.setText(str(data.get("stories_max", defaults["stories_max"])))

        # Load Follow Settings
        follow_defaults = {
            "highlights_min": 2,
            "highlights_max": 4,
            "likes_min": 1,
            "likes_max": 2,
            "following_limit": 3000,
        }
        follow_data = follow_defaults.copy()
        if self.follow_settings_path.exists():
             try:
                loaded = json.loads(self.follow_settings_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    follow_data.update(loaded)
             except Exception as e:
                print(f"Failed to load Follow settings: {e}")
        
        self.highlights_min_input.setText(str(follow_data.get("highlights_min", follow_defaults["highlights_min"])))
        self.highlights_max_input.setText(str(follow_data.get("highlights_max", follow_defaults["highlights_max"])))
        self.likes_min_input.setText(str(follow_data.get("likes_min", follow_defaults["likes_min"])))
        self.likes_max_input.setText(str(follow_data.get("likes_max", follow_defaults["likes_max"])))
        self.following_limit_input.setText(str(follow_data.get("following_limit", follow_defaults["following_limit"])))

        # Load Unfollow Settings
        unfollow_defaults = {
            "min_delay": 10,
            "max_delay": 30,
            "do_unfollow": False,
            "do_approve": False,
            "do_message": False
        }
        unfollow_data = unfollow_defaults.copy()
        if self.unfollow_settings_path.exists():
            try:
                loaded = json.loads(self.unfollow_settings_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    unfollow_data.update(loaded)
            except Exception as e:
                print(f"Failed to load Unfollow settings: {e}")

        self.unfollow_checkbox.setChecked(unfollow_data.get("do_unfollow", False))
        self.approve_checkbox.setChecked(unfollow_data.get("do_approve", False))
        self.message_checkbox.setChecked(unfollow_data.get("do_message", False))
        self.unfollow_min_delay_input.setText(str(unfollow_data.get("min_delay", 10)))
        self.unfollow_max_delay_input.setText(str(unfollow_data.get("max_delay", 30)))

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
            "min_time_minutes": parse_int_field(self.feed_time_min_input, 1),
            "max_time_minutes": parse_int_field(self.feed_time_max_input, 3),
            "feed_min_time_minutes": parse_int_field(self.feed_time_min_input, 1),
            "feed_max_time_minutes": parse_int_field(self.feed_time_max_input, 3),
            "reels_min_time_minutes": parse_int_field(self.reels_time_min_input, 1),
            "reels_max_time_minutes": parse_int_field(self.reels_time_max_input, 3),
            "cycle_interval_minutes": parse_int_field(self.scrolling_cycle_input, 11),
            "enable_feed": self.feed_checkbox.isChecked(),
            "enable_reels": self.reels_checkbox.isChecked(),
            "enable_follow": self.follow_checkbox.isChecked(),
            "parallel_profiles": parse_int_field(self.parallel_profiles_input, 1),
            "watch_stories": self.watch_stories_checkbox.isChecked(),
        }

        try:
            self.settings_path.write_text(json.dumps(payload, indent=4, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"Failed to save Instagram settings: {e}")

        # Save Follow Settings
        follow_payload = {
            "enable_follow": self.follow_checkbox.isChecked(),
            "highlights_min": parse_int_field(self.highlights_min_input, 2),
            "highlights_max": parse_int_field(self.highlights_max_input, 4),
            "likes_min": parse_int_field(self.likes_min_input, 1),
            "likes_max": parse_int_field(self.likes_max_input, 2),
            "following_limit": parse_int_field(self.following_limit_input, 3000),
        }

        try:
            self.follow_settings_path.write_text(json.dumps(follow_payload, indent=4, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"Failed to save Follow settings: {e}")

        # Save Unfollow Settings
        unfollow_payload = {
            "min_delay": parse_int_field(self.unfollow_min_delay_input, 10),
            "max_delay": parse_int_field(self.unfollow_max_delay_input, 30),
            "do_unfollow": self.unfollow_checkbox.isChecked(),
            "do_approve": self.approve_checkbox.isChecked(),
            "do_message": self.message_checkbox.isChecked()
        }
        
        try:
            self.unfollow_settings_path.write_text(json.dumps(unfollow_payload, indent=4, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"Failed to save Unfollow settings: {e}")
