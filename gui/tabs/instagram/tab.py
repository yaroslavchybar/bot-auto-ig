import json
from pathlib import Path
from datetime import datetime
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QCheckBox, QComboBox, QTextEdit, QGridLayout, QFrame,
    QScrollArea, QListWidget, QAbstractItemView, QMessageBox
)
from PyQt6.QtCore import Qt
from core.models import ThreadsAccount, ScrollingConfig
from gui.workers.instagram_worker import InstagramScrollingWorker
from gui.workers.follow_worker import AutoFollowWorker
from gui.workers.unfollow_worker import UnfollowWorker
from gui.styles import (
    CARD_STYLE, ACTION_BTN_STYLE, INPUT_STYLE,
    CHECKBOX_STYLE, BUTTON_STYLE
)
from .components import ToggleHeader, create_header_input
from .settings import SettingsMixin
from .dialogs import DialogsMixin

class InstagramTab(QWidget, SettingsMixin, DialogsMixin):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self.worker = None
        self.follow_worker = None
        self.unfollow_worker = None
        # Adjust path to point to parent of gui (anti root)
        # gui/tabs/instagram/tab.py -> parents[0]=instagram, [1]=tabs, [2]=gui, [3]=anti
        self.settings_path = Path(__file__).resolve().parents[3] / "instagram_settings.json"
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

        # Content Wrapper
        self.target_content = QWidget()
        t_grid = QGridLayout(self.target_content)
        t_grid.setContentsMargins(0, 0, 0, 0)

        # Header
        self.target_toggle = ToggleHeader("🎯 Цель и Активность", self.target_content)
        target_layout.addWidget(self.target_toggle)

        # Content Grid
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

        target_layout.addWidget(self.target_content)
        content_layout.addWidget(target_card)

        # --- SECTION: Execution Order ---
        order_card = QFrame()
        order_card.setStyleSheet(CARD_STYLE)
        order_layout = QVBoxLayout(order_card)
        order_layout.setContentsMargins(20, 20, 20, 20)
        order_layout.setSpacing(15)

        # Content Wrapper
        self.order_content = QWidget()
        order_content_layout = QVBoxLayout(self.order_content)
        order_content_layout.setContentsMargins(0, 0, 0, 0)

        # Header
        self.order_toggle = ToggleHeader("📋 Порядок действий", self.order_content)
        order_layout.addWidget(self.order_toggle)

        # Controls for adding/removing actions
        order_controls = QHBoxLayout()
        self.action_combo = QComboBox()
        self.action_combo.addItems(["Feed Scroll", "Reels Scroll", "Follow", "Unfollow", "Approve Requests", "Send Messages"])
        self.action_combo.setStyleSheet(INPUT_STYLE + "padding: 5px;")
        
        self.add_action_btn = QPushButton("➕ Добавить")
        self.add_action_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.add_action_btn.setStyleSheet(BUTTON_STYLE)
        self.add_action_btn.clicked.connect(self.add_action_to_order)
        
        self.remove_action_btn = QPushButton("➖ Удалить")
        self.remove_action_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.remove_action_btn.setStyleSheet(BUTTON_STYLE.replace("#61afef", "#e06c75")) # Reddish style
        self.remove_action_btn.clicked.connect(self.remove_action_from_order)
        
        order_controls.addWidget(self.action_combo)
        order_controls.addWidget(self.add_action_btn)
        order_controls.addWidget(self.remove_action_btn)
        order_content_layout.addLayout(order_controls)

        self.action_order_list = QListWidget()
        self.action_order_list.setStyleSheet("""
            QListWidget {
                background-color: #21252b;
                border: 1px solid #3e4042;
                border-radius: 6px;
                color: #abb2bf;
                padding: 5px;
            }
            QListWidget::item {
                padding: 8px;
                border-bottom: 1px solid #2c313a;
            }
            QListWidget::item:selected {
                background-color: #2c313a;
            }
        """)
        self.action_order_list.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)
        self.action_order_list.setDefaultDropAction(Qt.DropAction.MoveAction)
        self.action_order_list.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.action_order_list.setMinimumHeight(300) # Ensure all items are visible
        
        # Initial Items (will be reordered in load_settings)
        default_actions = ["Feed Scroll", "Reels Scroll", "Follow", "Unfollow", "Approve Requests", "Send Messages"]
        self.action_order_list.addItems(default_actions)
        
        # Connect signal to save settings on reorder
        self.action_order_list.model().rowsMoved.connect(self.save_settings)

        order_content_layout.addWidget(self.action_order_list)
        order_layout.addWidget(self.order_content)
        content_layout.addWidget(order_card)

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

    def add_action_to_order(self):
        if not self.add_action_btn.isEnabled():
            return
        action = self.action_combo.currentText()
        self.action_order_list.addItem(action)
        self.save_settings()
        # Newly added item is visible by default, but let's be safe
        self.update_order_visibility()

    def remove_action_from_order(self):
        current_row = self.action_order_list.currentRow()
        if current_row >= 0:
            self.action_order_list.takeItem(current_row)
            self.save_settings()

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

        # === PREPARE CONFIGURATION ===
        
        # Follow Config
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

        # Unfollow/Approve/Message Config
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
            
        unfollow_delay_range = (uf_min, uf_max)

        # Message Texts
        message_texts = []
        if enable_message:
            try:
                msg_path = Path("message.txt")
                if msg_path.exists():
                    content = msg_path.read_text(encoding="utf-8").strip()
                    if content:
                        message_texts = [line.strip() for line in content.split('\n') if line.strip()]
            except Exception:
                pass

        # === DECIDE EXECUTION PATH ===
        
        is_scrolling_mode = enable_feed or enable_reels
        
        if is_scrolling_mode:
            # --- PATH A: SCROLLING WORKER (Handles everything with Page Reuse) ---
            
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
                reels_skip_chance = int(self.reels_skip_chance_slider.currentText().replace('%', ''))
                
                reels_skip_min = float(self.reels_skip_min_input.text().split()[0])
                reels_skip_max = float(self.reels_skip_max_input.text().split()[0])
                reels_normal_min = float(self.reels_normal_min_input.text().split()[0])
                reels_normal_max = float(self.reels_normal_max_input.text().split()[0])

                feed_min_time = int(self.feed_time_min_input.text().split()[0])
                feed_max_time = int(self.feed_time_max_input.text().split()[0])
                reels_min_time = int(self.reels_time_min_input.text().split()[0])
                reels_max_time = int(self.reels_time_max_input.text().split()[0])
                
                cycle_interval = int(self.scrolling_cycle_input.text().split()[0])
                parallel_profiles = int(self.parallel_profiles_input.text().split()[0])
                
                feed_carousel_max_slides = int(self.feed_carousel_max_input.text().split()[0])
                feed_stories_max = int(self.feed_stories_max_input.text().split()[0])

                # Collect action order from list
                action_order = [self.action_order_list.item(i).text() for i in range(self.action_order_list.count())]

                config = ScrollingConfig(
                    use_private_profiles=True,
                    use_threads_profiles=False,
                    action_order=action_order,
                    like_chance=feed_like_chance,
                    comment_chance=0,
                    follow_chance=feed_follow_chance,
                    reels_like_chance=reels_like_chance,
                    reels_follow_chance=reels_follow_chance,
                    reels_skip_chance=reels_skip_chance,
                    reels_skip_min_time=reels_skip_min,
                    reels_skip_max_time=reels_skip_max,
                    reels_normal_min_time=reels_normal_min,
                    reels_normal_max_time=reels_normal_max,
                    min_time_minutes=feed_min_time,
                    max_time_minutes=feed_max_time,
                    feed_min_time_minutes=feed_min_time,
                    feed_max_time_minutes=feed_max_time,
                    reels_min_time_minutes=reels_min_time,
                    reels_max_time_minutes=reels_max_time,
                    cycle_interval_minutes=cycle_interval,
                    enable_feed=enable_feed,
                    enable_reels=enable_reels,
                    
                    # Passed Flags
                    enable_follow=enable_follow,
                    enable_unfollow=enable_unfollow,
                    enable_approve=enable_approve,
                    enable_message=enable_message,
                    
                    carousel_watch_chance=feed_carousel_watch_chance,
                    carousel_max_slides=feed_carousel_max_slides,
                    watch_stories=self.watch_stories_checkbox.isChecked(),
                    stories_max=feed_stories_max,
                    
                    # Passed Configs
                    highlights_range=highlights_range,
                    likes_range=likes_range,
                    following_limit=following_limit,
                    unfollow_delay_range=unfollow_delay_range,
                    message_texts=message_texts
                )
                
                profile_names = [acc.username for acc in target_accounts]
                
                tasks = []
                if enable_feed: tasks.append("Feed")
                if enable_reels: tasks.append("Reels")
                if enable_follow: tasks.append("Follow")
                if enable_unfollow: tasks.append("Unfollow")
                if enable_approve: tasks.append("Approve")
                if enable_message: tasks.append("Message")
                
                self.log(f"🔄 Запуск полного цикла ({', '.join(tasks)}) для {len(target_accounts)} профилей...")
                
                self.worker = InstagramScrollingWorker(config, target_accounts, profile_names)
                self.worker.log_signal.connect(self.log)
                self.worker.finished_signal.connect(self.on_worker_finished)
                self.worker.start()

        else:
            # --- PATH B: INDIVIDUAL WORKERS (No Feed/Reels) ---
            
            # Start Follow Worker
            if enable_follow:
                self.follow_worker = AutoFollowWorker(
                    highlights_range=highlights_range,
                    likes_range=likes_range,
                    following_limit=following_limit,
                )
                self.follow_worker.log_signal.connect(self.log)
                self.follow_worker.finished_signal.connect(self.on_follow_finished)
                self.follow_worker.start()
                self.log("▶️ Запуск автоподписки...")

            # Start Unfollow/Approve/Message Worker
            if enable_unfollow or enable_approve or enable_message:
                self.unfollow_worker = UnfollowWorker(
                    delay_range=unfollow_delay_range,
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
