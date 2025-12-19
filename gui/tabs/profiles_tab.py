from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QGroupBox, QMessageBox, QScrollArea, QFrame,
    QRadioButton, QButtonGroup, QCheckBox, QComboBox, QLineEdit,
    QDialog, QDialogButtonBox, QGridLayout, QSizePolicy, QApplication
)
from PyQt6.QtCore import Qt, pyqtSignal, QSize
from PyQt6.QtGui import QIcon, QFont, QColor, QCursor
import random
from utils.totp import generate_totp_code

from gui.styles import (
    CARD_STYLE, STATUS_RUNNING, STATUS_IDLE, STATUS_STOPPED,
    BUTTON_STYLE, ACTION_BTN_STYLE, PRIMARY_BTN_STYLE, INPUT_STYLE,
    DIALOG_STYLE, CHECKBOX_STYLE
)


class ProfileCreationDialog(QDialog):
    def __init__(self, parent=None, editing_profile=None, editing_category=None):
        super().__init__(parent)
        self.editing_profile = editing_profile
        self.editing_category = editing_category
        self.editing_index = None

        # Set dialog mode
        if editing_profile:
            self.setWindowTitle("Редактирование профиля")
        else:
            self.setWindowTitle("Создание нового профиля")

        self.setModal(True)
        self.resize(550, 550)
        self.setStyleSheet(
            DIALOG_STYLE + 
            CHECKBOX_STYLE +
            INPUT_STYLE + 
            PRIMARY_BTN_STYLE.replace("QPushButton", "QPushButton#saveBtn")
        )

        # Form elements
        self.profile_name_input = QLineEdit()
        self.profile_name_input.setPlaceholderText("Например: Instagram Main")

        self.profile_type_combo = QComboBox()
        self.profile_type_combo.addItems(["Camoufox (рекомендуется)", "Standard Firefox"])
        # Styles are handled by DIALOG_STYLE now

        self.proxy_radio = QRadioButton("Использовать PROXY")
        self.direct_radio = QRadioButton("Прямое подключение")
        self.direct_radio.setChecked(True)

        self.connection_group = QButtonGroup()
        self.connection_group.addButton(self.proxy_radio)
        self.connection_group.addButton(self.direct_radio)

        self.proxy_input = QLineEdit()
        self.proxy_input.setPlaceholderText("ip:port:login:pass")
        self.proxy_input.setEnabled(False)

        self.user_agent_input = QLineEdit()
        self.user_agent_input.setPlaceholderText("User Agent (оставьте пустым для авто-генерации")
        
        self.generate_ua_btn = QPushButton("🎲")
        self.generate_ua_btn.setToolTip("Сгенерировать случайный User Agent")
        self.generate_ua_btn.setFixedWidth(40)
        self.generate_ua_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.generate_ua_btn.clicked.connect(self.generate_user_agent)
        self.generate_ua_btn.setStyleSheet("""
            QPushButton {
                background-color: #3e4042;
                color: white;
                border: 1px solid #5c6370;
                border-radius: 4px;
                font-size: 16px;
            }
            QPushButton:hover {
                background-color: #4b5263;
            }
        """)

        self.test_ip_checkbox = QCheckBox("Проверить IP перед запуском")

        # Connect signals
        self.proxy_radio.toggled.connect(self.toggle_proxy_input)

        # Pre-fill form if editing
        if editing_profile:
            self.load_profile_data(editing_profile)
        else:
            # Generate UA for new profile automatically
            self.generate_user_agent()

        self.setup_ui()

    def generate_user_agent(self):
        """Generate a random modern User Agent"""
        user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0"
        ]
        ua = random.choice(user_agents)
        self.user_agent_input.setText(ua)

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(20)

        # Header code could go here, but window title is usually enough

        # Main Info
        info_layout = QVBoxLayout()
        info_layout.setSpacing(10)
        info_layout.addWidget(QLabel("Название профиля"))
        info_layout.addWidget(self.profile_name_input)
        
        info_layout.addWidget(QLabel("Тип браузера"))
        info_layout.addWidget(self.profile_type_combo)
        layout.addLayout(info_layout)

        # Connection Settings Group
        conn_group = QGroupBox("Настройки")
        conn_layout = QVBoxLayout(conn_group)
        conn_layout.setContentsMargins(15, 20, 15, 15)
        conn_layout.setSpacing(15)

        # Connection Mode Row
        mode_layout = QHBoxLayout()
        mode_layout.addWidget(self.direct_radio)
        mode_layout.addWidget(self.proxy_radio)
        mode_layout.addStretch()
        conn_layout.addLayout(mode_layout)

        # Proxy String
        conn_layout.addWidget(QLabel("Данные PROXY"))
        conn_layout.addWidget(self.proxy_input)

        # User Agent
        conn_layout.addWidget(QLabel("User Agent"))
        ua_layout = QHBoxLayout()
        ua_layout.addWidget(self.user_agent_input)
        ua_layout.addWidget(self.generate_ua_btn)
        conn_layout.addLayout(ua_layout)

        # Test IP Checkbox
        conn_layout.addWidget(self.test_ip_checkbox)

        layout.addWidget(conn_group)

        # Buttons
        button_box = QHBoxLayout()
        button_box.addStretch()

        cancel_btn = QPushButton("Отмена")
        cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        cancel_btn.setStyleSheet("background: transparent; color: #abb2bf; border: none; font-weight: bold;")
        cancel_btn.clicked.connect(self.reject)

        save_btn = QPushButton("Сохранить")
        save_btn.setObjectName("saveBtn")
        save_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        save_btn.clicked.connect(self.accept)

        if self.editing_profile:
            save_btn.setText("Сохранить")
        else:
            save_btn.setText("Создать")

        button_box.addWidget(cancel_btn)
        button_box.addWidget(save_btn)

        layout.addLayout(button_box)

    def toggle_proxy_input(self, checked):
        """Enable/disable proxy input based on radio selection"""
        self.proxy_input.setEnabled(checked)
        if not checked:
            self.proxy_input.clear()
            self.proxy_input.setStyleSheet(INPUT_STYLE)
        else:
             self.proxy_input.setFocus()

    def load_profile_data(self, profile):
        """Load profile data into form for editing"""
        self.profile_name_input.setText(profile.get('name', ''))

        # Set profile type
        ptype = profile.get('type', "Camoufox (рекомендуется)")
        index = self.profile_type_combo.findText(ptype)
        if index >= 0:
            self.profile_type_combo.setCurrentIndex(index)

        # Set proxy settings
        if profile.get('proxy'):
            self.proxy_radio.setChecked(True)
            self.proxy_input.setText(profile['proxy'])
            self.proxy_input.setEnabled(True)
        else:
            self.direct_radio.setChecked(True)
            self.proxy_input.clear()
            self.proxy_input.setEnabled(False)

        # Set User Agent
        self.user_agent_input.setText(profile.get('user_agent', ''))

        # Set test IP checkbox
        self.test_ip_checkbox.setChecked(profile.get('test_ip', False))

    def get_profile_data(self):
        """Get profile data from form"""
        name = self.profile_name_input.text().strip()
        if not name:
            raise ValueError("Введите название профиля!")

        proxy = self.proxy_input.text().strip() if self.proxy_radio.isChecked() else None
        user_agent = self.user_agent_input.text().strip() or None
        test_ip = self.test_ip_checkbox.isChecked()
        profile_type = self.profile_type_combo.currentText()

        return {
            "name": name,
            "proxy": proxy,
            "user_agent": user_agent,
            "test_ip": test_ip,
            "type": profile_type
        }

    def set_editing_index(self, category, index):
        """Set editing context for validation"""
        self.editing_category = category
        self.editing_index = index


class ProfileCard(QFrame):
    start_signal = pyqtSignal(str)
    stop_signal = pyqtSignal(str)
    edit_signal = pyqtSignal(str)
    delete_signal = pyqtSignal(str)

    def __init__(self, profile_data, is_running=False, parent=None):
        super().__init__(parent)
        self.profile_data = profile_data
        self.name = profile_data.get("name", "Unknown")
        self.is_running = is_running
        self.setStyleSheet(CARD_STYLE)
        self.setFixedHeight(55) # Reduced height for compactness
        
        self.setup_ui()

    def setup_ui(self):
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 4, 10, 4) # Reduced margins further
        layout.setSpacing(12) # Reduced spacing

        # Icon / Status Indicator
        status_color = "#98c379" if self.is_running else "#61afef"
        self.status_indicator = QLabel("●")
        self.status_indicator.setStyleSheet(f"color: {status_color}; font-size: 14px;") # Smaller indicator
        layout.addWidget(self.status_indicator)

        # Info Layout (Name + Proxy)
        info_layout = QVBoxLayout()
        info_layout.setSpacing(0) # Minimal vertical spacing
        info_layout.setAlignment(Qt.AlignmentFlag.AlignVCenter)

        name_label = QLabel(self.name)
        name_label.setObjectName("profileName")
        info_layout.addWidget(name_label)

        proxy_str = self.profile_data.get("proxy", "Direct Connection")
        if not proxy_str:
            proxy_str = "Direct Connection"
        else:
            # Truncate if too long
            if len(proxy_str) > 35: # Slightly tighter truncation
                proxy_str = proxy_str[:32] + "..."
        
        proxy_label = QLabel(f"🌐 {proxy_str}")
        proxy_label.setObjectName("proxyInfo")
        info_layout.addWidget(proxy_label)

        layout.addLayout(info_layout, stretch=1)

        # Action Buttons Layout
        actions_layout = QHBoxLayout()
        actions_layout.setSpacing(6) # Tighter button spacing

        # Start/Stop Button
        if self.is_running:
            self.stop_btn = QPushButton("⏹ STOP")
            self.stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            self.stop_btn.setStyleSheet("""
                QPushButton {
                    background-color: rgba(224, 108, 117, 0.2);
                    color: #e06c75;
                    border: 1px solid #e06c75;
                    border-radius: 4px;
                    padding: 4px 10px;
                    font-size: 11px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background-color: rgba(224, 108, 117, 0.3);
                }
            """)
            self.stop_btn.clicked.connect(lambda: self.stop_signal.emit(self.name))
            actions_layout.addWidget(self.stop_btn)
        else:
            self.start_btn = QPushButton("▶ START")
            self.start_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            self.start_btn.setStyleSheet("""
                QPushButton {
                    background-color: rgba(97, 175, 239, 0.2);
                    color: #61afef;
                    border: 1px solid #61afef;
                    border-radius: 4px;
                    padding: 4px 10px;
                    font-size: 11px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background-color: rgba(97, 175, 239, 0.3);
                }
            """)
            self.start_btn.clicked.connect(lambda: self.start_signal.emit(self.name))
            actions_layout.addWidget(self.start_btn)

        # Edit Button
        self.edit_btn = QPushButton("⚙")
        self.edit_btn.setToolTip("Настройки")
        self.edit_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.edit_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #abb2bf;")
        self.edit_btn.clicked.connect(lambda: self.edit_signal.emit(self.name))
        actions_layout.addWidget(self.edit_btn)

        # Delete Button
        self.delete_btn = QPushButton("🗑")
        self.delete_btn.setToolTip("Удалить")
        self.delete_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.delete_btn.setStyleSheet(ACTION_BTN_STYLE + "font-size: 14px; color: #e06c75;")
        self.delete_btn.clicked.connect(lambda: self.delete_signal.emit(self.name))
        actions_layout.addWidget(self.delete_btn)

        layout.addLayout(actions_layout)


class ProfilesTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window # Reference to main window for log/managers
        self.setup_ui()

    def setup_ui(self):
        # Apply global stylesheet for this tab if needed, but components handle their own
        self.setStyleSheet("background-color: #1e2125;") 

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(30, 30, 30, 30)
        main_layout.setSpacing(25)

        # === 1. TOP HEADER (Title + Create Button) ===
        header_layout = QHBoxLayout()
        
        title_label = QLabel("Профили")
        title_label.setStyleSheet("color: white; font-size: 28px; font-weight: bold;")
        
        header_layout.addWidget(title_label)
        header_layout.addStretch()

        self.create_btn = QPushButton("+ Новый профиль")
        self.create_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.create_btn.setStyleSheet(PRIMARY_BTN_STYLE)
        self.create_btn.clicked.connect(lambda: self.show_create_profile_dialog())
        header_layout.addWidget(self.create_btn)

        main_layout.addLayout(header_layout)

        # === 2. PROFILES LIST (Scroll Area) ===
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll_area.setStyleSheet("""
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

        self.profiles_container = QWidget()
        self.profiles_container.setStyleSheet("background: transparent;")
        
        # We use a vertical layout for the container of cards
        self.profiles_layout = QVBoxLayout(self.profiles_container)
        self.profiles_layout.setAlignment(Qt.AlignmentFlag.AlignTop)
        self.profiles_layout.setSpacing(8)
        self.profiles_layout.setContentsMargins(0, 0, 10, 0) # Right margin for scrollbar

        self.scroll_area.setWidget(self.profiles_container)
        main_layout.addWidget(self.scroll_area)

        # === 3. BOTTOM SECTION (TOTP) ===
        # We can make this look like a card effectively
        totp_frame = QFrame()
        totp_frame.setStyleSheet("""
            QFrame {
                background-color: #262a30;
                border-radius: 12px;
                border: 1px solid #3e4042;
                padding: 10px;
            }
        """)
        totp_layout = QHBoxLayout(totp_frame)
        totp_layout.setContentsMargins(20, 15, 20, 15)
        
        totp_label = QLabel("🔐 2FA Генератор")
        totp_label.setStyleSheet("color: #e0e0e0; font-weight: bold; font-size: 14px; border: none;")
        
        self.totp_secret = QLineEdit()
        self.totp_secret.setPlaceholderText("Вставьте секретный ключ (Base32)...")
        self.totp_secret.setStyleSheet(INPUT_STYLE + "border: none; background: #1e2125;")
        
        self.totp_code_display = QLineEdit()
        self.totp_code_display.setPlaceholderText("------")
        self.totp_code_display.setReadOnly(True)
        self.totp_code_display.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.totp_code_display.setFixedWidth(100)
        self.totp_code_display.setStyleSheet(INPUT_STYLE + "color: #61afef; font-weight: bold; background: #1e2125; border: none;")

        generate_btn = QPushButton("Создать")
        generate_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        generate_btn.setStyleSheet(BUTTON_STYLE)
        generate_btn.clicked.connect(self.generate_totp)

        copy_btn = QPushButton("Копировать")
        copy_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        copy_btn.setStyleSheet(BUTTON_STYLE)
        copy_btn.clicked.connect(self.copy_totp)

        totp_layout.addWidget(totp_label)
        totp_layout.addWidget(self.totp_secret)
        totp_layout.addWidget(generate_btn)
        totp_layout.addWidget(self.totp_code_display)
        totp_layout.addWidget(copy_btn)

        main_layout.addWidget(totp_frame)

        # Initial refresh
        self.refresh_lists()

    def refresh_lists(self):
        """Clear and rebuild the profiles list"""
        # Clear existing items
        while self.profiles_layout.count():
            item = self.profiles_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        
        # Get profiles
        profiles = self.main_window.profile_manager.profiles.get("private", [])

        if not profiles:
            empty_label = QLabel("Нет профилей. Создайте первый!")
            empty_label.setStyleSheet("color: #abb2bf; font-style: italic; margin-top: 20px;")
            empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.profiles_layout.addWidget(empty_label)
            return

        for profile in profiles:
            name = profile['name']
            is_running = self.main_window.process_manager.is_running(name)
            
            card = ProfileCard(profile, is_running)
            card.start_signal.connect(self.handle_start_profile)
            card.stop_signal.connect(self.handle_stop_profile)
            card.edit_signal.connect(self.handle_edit_profile)
            card.delete_signal.connect(self.handle_delete_profile)
            
            self.profiles_layout.addWidget(card)

    # --- HANDLERS ---
    
    def show_create_profile_dialog(self, editing_profile=None, editing_category=None, editing_index=None):
        """Show the profile creation/editing dialog"""
        dialog = ProfileCreationDialog(self, editing_profile, editing_category)
        if editing_index is not None:
            dialog.set_editing_index(editing_category, editing_index)

        if dialog.exec() == QDialog.DialogCode.Accepted:
            try:
                profile_data = dialog.get_profile_data()
                self.create_profile_from_data(profile_data, editing_category, editing_index)
            except ValueError as e:
                QMessageBox.warning(self, "Ошибка", str(e))

    def create_profile_from_data(self, profile_data, editing_category=None, editing_index=None):
        """Create or update profile from provided data"""
        name = profile_data["name"]

        # Check for duplicate names
        profiles = self.main_window.profile_manager.profiles
        for cat in ["private", "threads"]:
            for i, p in enumerate(profiles.get(cat, [])):
                if p["name"] == name:
                    # Allow same name if editing the same profile
                    if editing_category == cat and editing_index == i:
                        continue
                    QMessageBox.warning(self, "Ошибка", f"Профиль '{name}' уже существует!")
                    return

        if editing_category and editing_index is not None:
            # Update existing profile
            self.main_window.profile_manager.update_profile(editing_category, editing_index, profile_data)
            self.main_window.log(f"✏️ Обновлен профиль: {name}")
        else:
            # Create new profile
            category = "private"  # Default to private profiles
            self.main_window.profile_manager.add_profile(category, profile_data)
            self.main_window.log(f"✅ Создан профиль: {name}")

        self.refresh_lists()

    def handle_start_profile(self, name):
        """Launch a private profile"""
        # Find profile data
        profiles = self.main_window.profile_manager.profiles.get("private", [])
        profile = next((p for p in profiles if p['name'] == name), None)
        
        if not profile:
            return

        proxy = profile.get('proxy') or "None"
        user_agent = profile.get('user_agent')

        if self.main_window.process_manager.is_running(name):
             QMessageBox.information(self, "Инфо", f"Профиль '{name}' уже запущен!")
             self.refresh_lists() # Refresh UI just in case
             return

        success, msg = self.main_window.process_manager.start_profile(name, proxy, user_agent=user_agent)
        if success:
            self.main_window.log(f"🚀 Запущен профиль: {name}")
            # Sync status to database/manager
            self.main_window.profile_manager.update_profile_status(name, "running", True)
            self.refresh_lists()
        else:
            QMessageBox.warning(self, "Ошибка", f"Не удалось запустить: {msg}")

    def handle_stop_profile(self, name):
        """Stop a private profile"""
        if self.main_window.process_manager.stop_profile(name):
            self.main_window.log(f"⏹️ Остановлен профиль: {name}")
            self.main_window.profile_manager.update_profile_status(name, "idle", False)
            self.refresh_lists()
        else:
            QMessageBox.information(self, "Инфо", f"Профиль '{name}' не запущен!")
            self.refresh_lists()

    def handle_edit_profile(self, name):
        """Load private profile for editing"""
        profiles = self.main_window.profile_manager.profiles.get("private", [])
        
        # Find index and profile
        for i, profile in enumerate(profiles):
            if profile['name'] == name:
                self.show_create_profile_dialog(profile, "private", i)
                return

    def handle_delete_profile(self, name):
        """Delete a private profile"""
        # Stop if running
        if self.main_window.process_manager.is_running(name):
            self.handle_stop_profile(name)

        confirm = QMessageBox.question(
            self, "Подтверждение", f"Удалить профиль '{name}'?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if confirm == QMessageBox.StandardButton.Yes:
            # Find index
            profiles = self.main_window.profile_manager.profiles.get("private", [])
            for i, profile in enumerate(profiles):
                if profile['name'] == name:
                    self.main_window.profile_manager.delete_profile("private", i)
                    break
            
            self.refresh_lists()
            self.main_window.log(f"🗑️ Удален профиль: {name}")

    def generate_totp(self):
        secret = self.totp_secret.text().strip()
        if not secret:
            QMessageBox.warning(self, "Ошибка", "Введите секретный ключ!")
            return

        try:
            code = generate_totp_code(secret)
            self.totp_code_display.setText(code)
            self.main_window.log(f"🔑 Сгенерирован TOTP код: {code}")
        except ValueError as e:
            QMessageBox.warning(self, "Ошибка", str(e))
        except Exception as e:
            QMessageBox.warning(self, "Ошибка", f"Ошибка генерации: {e}")

    def copy_totp(self):
        code = self.totp_code_display.text()
        if code and code != "------":
            clipboard = QApplication.clipboard()
            clipboard.setText(code)
            self.main_window.log("📎 Код скопирован в буфер обмена")
        else:
            QMessageBox.warning(self, "Ошибка", "Сначала сгенерируйте код!")
