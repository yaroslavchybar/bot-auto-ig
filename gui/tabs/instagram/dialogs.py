import json
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QCheckBox, QLineEdit, QComboBox, QTextEdit, QMessageBox, QTabWidget, QFrame
)
from PyQt6.QtCore import Qt, QTimer
from gui.styles import (
    INPUT_STYLE, CHECKBOX_STYLE, PRIMARY_BTN_STYLE, CARD_STYLE
)
from .components import SettingsDialog

class DialogsMixin:
    """Mixin for handling InstagramTab dialogs and settings widgets."""
    
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
        
        # --- STORIES SETTINGS DIALOG ---
        self.stories_settings_dialog = SettingsDialog("Настройки Stories", self)
        smax_layout = QHBoxLayout()
        smax_layout.addWidget(QLabel("👀 Макс сторис:"))
        self.feed_stories_max_input = QLineEdit("3")
        self.feed_stories_max_input.setStyleSheet(INPUT_STYLE)
        self.feed_stories_max_input.setFixedWidth(60)
        smax_layout.addWidget(self.feed_stories_max_input)
        self.stories_settings_dialog.add_layout(smax_layout)
        
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

        # Reels Skip (Short Watch)
        r_skip_layout = QHBoxLayout()
        r_skip_layout.addWidget(QLabel("⏭️ Пропуск (Reels):"))
        self.reels_skip_chance_slider = QComboBox()
        self.reels_skip_chance_slider.addItems(percent_options)
        self.reels_skip_chance_slider.setStyleSheet(INPUT_STYLE)
        self.reels_skip_chance_slider.setFixedWidth(80)
        r_skip_layout.addWidget(self.reels_skip_chance_slider)
        self.reels_settings_dialog.add_layout(r_skip_layout)

        # Reels Short Watch Time
        r_short_time_layout = QHBoxLayout()
        r_short_time_layout.addWidget(QLabel("⏱️ Short Watch (сек):"))
        self.reels_skip_min_input = QLineEdit("0.8")
        self.reels_skip_min_input.setStyleSheet(INPUT_STYLE)
        self.reels_skip_min_input.setFixedWidth(50)
        self.reels_skip_max_input = QLineEdit("2.0")
        self.reels_skip_max_input.setStyleSheet(INPUT_STYLE)
        self.reels_skip_max_input.setFixedWidth(50)
        r_short_time_layout.addWidget(self.reels_skip_min_input)
        r_short_time_layout.addWidget(QLabel("-"))
        r_short_time_layout.addWidget(self.reels_skip_max_input)
        self.reels_settings_dialog.add_layout(r_short_time_layout)

        # Reels Normal Watch Time
        r_normal_time_layout = QHBoxLayout()
        r_normal_time_layout.addWidget(QLabel("⏱️ Normal Watch (сек):"))
        self.reels_normal_min_input = QLineEdit("5.0")
        self.reels_normal_min_input.setStyleSheet(INPUT_STYLE)
        self.reels_normal_min_input.setFixedWidth(50)
        self.reels_normal_max_input = QLineEdit("20.0")
        self.reels_normal_max_input.setStyleSheet(INPUT_STYLE)
        self.reels_normal_max_input.setFixedWidth(50)
        r_normal_time_layout.addWidget(self.reels_normal_min_input)
        r_normal_time_layout.addWidget(QLabel("-"))
        r_normal_time_layout.addWidget(self.reels_normal_max_input)
        self.reels_settings_dialog.add_layout(r_normal_time_layout)

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

        # Likes Percentage
        lp_row = QHBoxLayout()
        lp_row.addWidget(QLabel("Лайков (% от постов):"))
        self.likes_percentage_input = QLineEdit("0")
        self.likes_percentage_input.setStyleSheet(INPUT_STYLE)
        self.likes_percentage_input.setFixedWidth(50)
        lp_row.addWidget(self.likes_percentage_input)
        lp_row.addWidget(QLabel("(0 = выкл)"))
        self.follow_settings_dialog.add_layout(lp_row)

        # Scroll Percentage
        sp_row = QHBoxLayout()
        sp_row.addWidget(QLabel("Скролл (% от постов):"))
        self.scroll_percentage_input = QLineEdit("0")
        self.scroll_percentage_input.setStyleSheet(INPUT_STYLE)
        self.scroll_percentage_input.setFixedWidth(50)
        sp_row.addWidget(self.scroll_percentage_input)
        sp_row.addWidget(QLabel("(0 = выкл)"))
        self.follow_settings_dialog.add_layout(sp_row)

        # Follow Limit
        fl_row = QHBoxLayout()
        fl_row.addWidget(QLabel("Макс. подписок у цели:"))
        self.following_limit_input = QLineEdit("3000")
        self.following_limit_input.setStyleSheet(INPUT_STYLE)
        self.following_limit_input.setFixedWidth(80)
        fl_row.addWidget(self.following_limit_input)
        self.follow_settings_dialog.add_layout(fl_row)
        
        # Follow Count Range
        f_count_layout = QHBoxLayout()
        f_count_layout.addWidget(QLabel("Мин-Макс за сессию:"))
        self.follow_min_count_input = QLineEdit("5")
        self.follow_min_count_input.setStyleSheet(INPUT_STYLE)
        self.follow_min_count_input.setFixedWidth(50)
        self.follow_max_count_input = QLineEdit("15")
        self.follow_max_count_input.setStyleSheet(INPUT_STYLE)
        self.follow_max_count_input.setFixedWidth(50)
        f_count_layout.addWidget(self.follow_min_count_input)
        f_count_layout.addWidget(QLabel("-"))
        f_count_layout.addWidget(self.follow_max_count_input)
        self.follow_settings_dialog.add_layout(f_count_layout)

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

        # Unfollow Count Range
        uf_count_layout = QHBoxLayout()
        uf_count_layout.addWidget(QLabel("Мин-Макс за сессию:"))
        self.unfollow_min_count_input = QLineEdit("5")
        self.unfollow_min_count_input.setStyleSheet(INPUT_STYLE)
        self.unfollow_min_count_input.setFixedWidth(50)
        self.unfollow_max_count_input = QLineEdit("15")
        self.unfollow_max_count_input.setStyleSheet(INPUT_STYLE)
        self.unfollow_max_count_input.setFixedWidth(50)
        uf_count_layout.addWidget(self.unfollow_min_count_input)
        uf_count_layout.addWidget(QLabel("-"))
        uf_count_layout.addWidget(self.unfollow_max_count_input)
        self.unfollow_settings_dialog.add_layout(uf_count_layout)

        # --- APPROVE SETTINGS DIALOG ---
        self.approve_settings_dialog = SettingsDialog("Настройки подтверждения", self)
        self.approve_settings_dialog.add_widget(QLabel("Нет доступных настроек для подтверждения заявок.\nПроцесс выполняется автоматически."))

        # --- MESSAGE SETTINGS DIALOG ---
        self.message_settings_dialog = SettingsDialog("Настройки рассылки", self)
        self.message_tabs = QTabWidget()

        self.msg_tab1 = QWidget()
        self.msg_tab1_layout = QVBoxLayout(self.msg_tab1)
        self.msg_tab1_layout.setContentsMargins(10, 10, 10, 10)
        msg1_card = QFrame()
        msg1_card.setStyleSheet("QFrame { background: transparent; border: none; }")
        msg1_card_layout = QVBoxLayout(msg1_card)
        msg1_card_layout.setContentsMargins(15, 15, 15, 15)
        msg1_title = QLabel("Текст сообщения (message.txt)")
        self.message_text_edit = QTextEdit()
        self.message_text_edit.setMinimumHeight(180)
        self.message_text_edit.setPlaceholderText("Введите варианты сообщений, одно на строку")
        msg1_card_layout.addWidget(msg1_title)
        msg1_card_layout.addWidget(self.message_text_edit)
        msg1_actions = QHBoxLayout()
        self.msg1_count_label = QLabel("Строк: 0 · Символов: 0")
        self.save_msg_btn = QPushButton("Сохранить")
        self.save_msg_btn.setStyleSheet(PRIMARY_BTN_STYLE)
        self.save_msg_btn.clicked.connect(lambda: self.save_message_text("message.txt", self.message_text_edit))
        msg1_actions.addWidget(self.msg1_count_label)
        msg1_actions.addStretch()
        msg1_actions.addWidget(self.save_msg_btn)
        msg1_card_layout.addLayout(msg1_actions)
        self.msg_tab1_layout.addWidget(msg1_card)

        self.msg_tab2 = QWidget()
        self.msg_tab2_layout = QVBoxLayout(self.msg_tab2)
        self.msg_tab2_layout.setContentsMargins(10, 10, 10, 10)
        msg2_card = QFrame()
        msg2_card.setStyleSheet("QFrame { background: transparent; border: none; }")
        msg2_card_layout = QVBoxLayout(msg2_card)
        msg2_card_layout.setContentsMargins(15, 15, 15, 15)
        msg2_title = QLabel("Текст сообщения (message_2.txt)")
        self.message_2_text_edit = QTextEdit()
        self.message_2_text_edit.setMinimumHeight(180)
        self.message_2_text_edit.setPlaceholderText("Введите варианты сообщений, одно на строку")
        msg2_card_layout.addWidget(msg2_title)
        msg2_card_layout.addWidget(self.message_2_text_edit)
        msg2_actions = QHBoxLayout()
        self.msg2_count_label = QLabel("Строк: 0 · Символов: 0")
        self.save_msg_2_btn = QPushButton("Сохранить")
        self.save_msg_2_btn.setStyleSheet(PRIMARY_BTN_STYLE)
        self.save_msg_2_btn.clicked.connect(lambda: self.save_message_text("message_2.txt", self.message_2_text_edit))
        msg2_actions.addWidget(self.msg2_count_label)
        msg2_actions.addStretch()
        msg2_actions.addWidget(self.save_msg_2_btn)
        msg2_card_layout.addLayout(msg2_actions)
        self.msg_tab2_layout.addWidget(msg2_card)

        self.message_text_edit.textChanged.connect(lambda: self._update_msg_counter(1))
        self.message_2_text_edit.textChanged.connect(lambda: self._update_msg_counter(2))

        self.message_tabs.addTab(self.msg_tab1, "Сообщение 1")
        self.message_tabs.addTab(self.msg_tab2, "Сообщение 2")
        self.message_settings_dialog.add_widget(self.message_tabs)

    def open_feed_settings(self):
        self.feed_settings_dialog.exec()

    def open_reels_settings(self):
        self.reels_settings_dialog.exec()

    def open_follow_settings(self):
        self.follow_settings_dialog.exec()
    
    def open_stories_settings(self):
        self.stories_settings_dialog.exec()

    def open_unfollow_settings(self):
        self.unfollow_settings_dialog.exec()

    def open_approve_settings(self):
        self.approve_settings_dialog.exec()

    def open_message_settings(self):
        try:
            msg_path = Path("message.txt")
            if msg_path.exists():
                self.message_text_edit.setText(msg_path.read_text(encoding="utf-8"))
            else:
                self.message_text_edit.clear()
        except Exception as e:
            self.log(f"Ошибка загрузки message.txt: {e}")
        try:
            msg_path_2 = Path("message_2.txt")
            if msg_path_2.exists():
                self.message_2_text_edit.setText(msg_path_2.read_text(encoding="utf-8"))
            else:
                self.message_2_text_edit.clear()
        except Exception as e:
            self.log(f"Ошибка загрузки message_2.txt: {e}")
        self._update_msg_counter(1)
        self._update_msg_counter(2)

        self.message_settings_dialog.exec()

    def save_message_text(self, filename, text_edit):
        try:
            content = text_edit.toPlainText()
            Path(filename).write_text(content, encoding="utf-8")
            self.message_settings_dialog.accept()
        except Exception as e:
            QMessageBox.warning(self.message_settings_dialog, "Ошибка", f"Не удалось сохранить {filename}: {e}")

    def _update_msg_counter(self, which):
        if which == 1:
            text = self.message_text_edit.toPlainText()
            lines = [l for l in text.splitlines() if l.strip()]
            self.msg1_count_label.setText(f"Строк: {len(lines)} · Символов: {len(text)}")
        else:
            text = self.message_2_text_edit.toPlainText()
            lines = [l for l in text.splitlines() if l.strip()]
            self.msg2_count_label.setText(f"Строк: {len(lines)} · Символов: {len(text)}")


