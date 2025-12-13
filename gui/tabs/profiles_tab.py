from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel, 
    QListWidget, QGroupBox, QMessageBox, QScrollArea, QFrame, 
    QRadioButton, QButtonGroup, QCheckBox, QComboBox, QLineEdit, QListWidgetItem, QApplication
)
from PyQt6.QtCore import Qt
from utils.totp import generate_totp_code

class ProfilesTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window # Reference to main window for log/managers
        self.editing_profile_index = None
        self.editing_profile_category = None
        self.setup_ui()

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

        # === NEW PROFILE SECTION ===
        self.new_profile_group = QGroupBox("🟢 Новый Camoufox профиль")
        np_layout = QVBoxLayout(self.new_profile_group)
        
        # Profile Name Row
        name_row = QHBoxLayout()
        name_label = QLabel("📝 Название профиля:")
        self.profile_name_input = QLineEdit()
        self.profile_name_input.setPlaceholderText("Введите название профиля")
        name_row.addWidget(name_label, 1)
        name_row.addWidget(self.profile_name_input, 3)
        np_layout.addLayout(name_row)
        
        # Profile Type Row
        type_row = QHBoxLayout()
        type_label = QLabel("⚙️ Тип профиля:")
        self.profile_type_combo = QComboBox()
        self.profile_type_combo.addItems(["Camoufox (рекомендуется)", "Standard Firefox"])
        type_row.addWidget(type_label, 1)
        type_row.addWidget(self.profile_type_combo, 3)
        np_layout.addLayout(type_row)
        
        # Connection Settings Group
        conn_group = QGroupBox("⚡ Camoufox профиль:")
        conn_layout = QVBoxLayout(conn_group)
        
        # Connection Settings Header
        conn_header = QLabel("🔌 Настройки подключения")
        conn_header.setObjectName("sectionHeader")
        conn_layout.addWidget(conn_header)
        
        # Proxy Mode Row
        mode_row = QHBoxLayout()
        mode_label = QLabel("⚡ Режим:")
        self.proxy_radio = QRadioButton("🔴 PROXY")
        self.direct_radio = QRadioButton("🟢 Прямое подключение")
        self.direct_radio.setChecked(True)
        
        self.connection_group = QButtonGroup()
        self.connection_group.addButton(self.proxy_radio)
        self.connection_group.addButton(self.direct_radio)
        self.proxy_radio.toggled.connect(self.toggle_proxy_input)
        
        mode_row.addWidget(mode_label)
        mode_row.addWidget(self.proxy_radio)
        mode_row.addWidget(self.direct_radio)
        mode_row.addStretch()
        conn_layout.addLayout(mode_row)
        
        # Proxy String Row
        proxy_row = QHBoxLayout()
        proxy_label = QLabel("🔑 PROXY строка:")
        self.proxy_input = QLineEdit()
        self.proxy_input.setPlaceholderText("ip:port:login:pass или socks5://ip:port:login:pass")
        self.proxy_input.setEnabled(False)
        proxy_row.addWidget(proxy_label, 1)
        proxy_row.addWidget(self.proxy_input, 3)
        conn_layout.addLayout(proxy_row)
        
        # Test IP Checkbox
        self.test_ip_checkbox = QCheckBox("🟢 Тестировать IP при запуске")
        conn_layout.addWidget(self.test_ip_checkbox)
        
        np_layout.addWidget(conn_group)
        
        # Buttons Row
        btns_row = QHBoxLayout()
        
        # Create/Save Profile Button
        self.create_btn = QPushButton("🔴 Создать профиль")
        self.create_btn.setStyleSheet("background-color: #333; padding: 12px; font-size: 14px;")
        self.create_btn.clicked.connect(self.create_profile)
        btns_row.addWidget(self.create_btn)
        
        # Cancel Edit Button (Initially Hidden)
        self.cancel_edit_btn = QPushButton("❌ Отмена")
        self.cancel_edit_btn.setStyleSheet("background-color: #555; padding: 12px; font-size: 14px;")
        self.cancel_edit_btn.clicked.connect(self.cancel_edit)
        self.cancel_edit_btn.setVisible(False)
        btns_row.addWidget(self.cancel_edit_btn)
        
        np_layout.addLayout(btns_row)
        
        layout.addWidget(self.new_profile_group)

        # === PROFILE MANAGEMENT SECTION ===
        mgmt_group = QGroupBox("📁 Управление профилями")
        mgmt_layout = QHBoxLayout(mgmt_group)
        
        # Left Panel - Private Profiles
        left_panel = QVBoxLayout()
        left_header = QLabel("🔒 Приватные профили")
        left_header.setObjectName("sectionHeader")
        left_panel.addWidget(left_header)
        
        self.private_list = QListWidget()
        left_panel.addWidget(self.private_list)
        
        left_buttons = QHBoxLayout()
        self.private_start_btn = QPushButton("🚀")
        self.private_start_btn.setToolTip("Запустить")
        self.private_start_btn.clicked.connect(lambda: self.launch_profile("private"))
        
        self.private_stop_btn = QPushButton("⏹️")
        self.private_stop_btn.setToolTip("Остановить")
        self.private_stop_btn.clicked.connect(lambda: self.stop_profile("private"))
        
        self.private_edit_btn = QPushButton("✏️")
        self.private_edit_btn.setToolTip("Редактировать")
        self.private_edit_btn.clicked.connect(lambda: self.load_profile_for_editing("private"))
        
        self.private_delete_btn = QPushButton("🗑️")
        self.private_delete_btn.setToolTip("Удалить")
        self.private_delete_btn.clicked.connect(lambda: self.delete_profile("private"))
        
        left_buttons.addWidget(self.private_start_btn)
        left_buttons.addWidget(self.private_stop_btn)
        left_buttons.addWidget(self.private_edit_btn)
        left_buttons.addWidget(self.private_delete_btn)
        left_panel.addLayout(left_buttons)
        
        # Right Panel - Threads Profiles
        right_panel = QVBoxLayout()
        right_header = QLabel("🔗 Instagram-профили")
        right_header.setObjectName("sectionHeader")
        right_panel.addWidget(right_header)
        
        self.threads_list = QListWidget()
        right_panel.addWidget(self.threads_list)
        
        right_buttons = QHBoxLayout()
        self.threads_start_btn = QPushButton("🚀")
        self.threads_start_btn.setToolTip("Запустить")
        self.threads_start_btn.clicked.connect(lambda: self.launch_profile("threads"))
        
        self.threads_stop_btn = QPushButton("⏹️")
        self.threads_stop_btn.setToolTip("Остановить")
        self.threads_stop_btn.clicked.connect(lambda: self.stop_profile("threads"))
        
        self.threads_edit_btn = QPushButton("✏️")
        self.threads_edit_btn.setToolTip("Редактировать")
        self.threads_edit_btn.clicked.connect(lambda: self.load_profile_for_editing("threads"))
        
        self.threads_delete_btn = QPushButton("🗑️")
        self.threads_delete_btn.setToolTip("Удалить")
        self.threads_delete_btn.clicked.connect(lambda: self.delete_profile("threads"))
        
        right_buttons.addWidget(self.threads_start_btn)
        right_buttons.addWidget(self.threads_stop_btn)
        right_buttons.addWidget(self.threads_edit_btn)
        right_buttons.addWidget(self.threads_delete_btn)
        right_panel.addLayout(right_buttons)
        
        mgmt_layout.addLayout(left_panel)
        mgmt_layout.addLayout(right_panel)
        
        layout.addWidget(mgmt_group)

        # === 2FA / TOTP GENERATOR SECTION ===
        totp_group = QGroupBox("🔑 2FA / TOTP генератор")
        totp_layout = QVBoxLayout(totp_group)
        
        secret_row = QHBoxLayout()
        secret_label = QLabel("🔒 Секрет (Base32):")
        self.secret_input = QLineEdit()
        self.secret_input.setPlaceholderText("JBSWY3DPEHPK3PXP...")
        secret_row.addWidget(secret_label, 1)
        secret_row.addWidget(self.secret_input, 4)
        totp_layout.addLayout(secret_row)
        
        code_row = QHBoxLayout()
        code_label = QLabel("🔢 Код (6 цифр):")
        self.code_output = QLineEdit()
        self.code_output.setReadOnly(True)
        self.code_output.setPlaceholderText("")
        
        self.get_code_btn = QPushButton("📋 Получить код")
        self.get_code_btn.clicked.connect(self.generate_totp)
        
        self.copy_code_btn = QPushButton("📎 Копировать")
        self.copy_code_btn.clicked.connect(self.copy_totp)
        
        code_row.addWidget(code_label, 1)
        code_row.addWidget(self.code_output, 2)
        code_row.addWidget(self.get_code_btn)
        code_row.addWidget(self.copy_code_btn)
        totp_layout.addLayout(code_row)
        
        layout.addWidget(totp_group)
        
        # Refresh profile lists
        self.refresh_lists()
        
        # Set the content widget to the scroll area
        scroll_area.setWidget(content_widget)
        
        # Add scroll area to the main layout
        main_layout.addWidget(scroll_area)

    def toggle_proxy_input(self, checked):
        """Enable/disable proxy input based on radio selection"""
        self.proxy_input.setEnabled(checked)
        if not checked:
            self.proxy_input.clear()

    def refresh_lists(self):
        """Refresh both profile lists"""
        self.private_list.clear()
        self.threads_list.clear()
        
        # Get profiles from manager
        profiles = self.main_window.profile_manager.profiles
        
        for profile in profiles.get("private", []):
            status = "🟢 Running" if self.main_window.process_manager.is_running(profile["name"]) else "⚫ Idle"
            proxy_info = f" | Proxy: {profile.get('proxy', 'Direct')[:30]}..." if profile.get('proxy') else ""
            item = QListWidgetItem(f"{profile['name']} {status}{proxy_info}")
            self.private_list.addItem(item)
        
        for profile in profiles.get("threads", []):
            status = "🟢 Running" if self.main_window.process_manager.is_running(profile["name"]) else "⚫ Idle"
            proxy_info = f" | Proxy: {profile.get('proxy', 'Direct')[:30]}..." if profile.get('proxy') else ""
            item = QListWidgetItem(f"{profile['name']} {status}{proxy_info}")
            self.threads_list.addItem(item)

    def create_profile(self):
        name = self.profile_name_input.text().strip()
        if not name:
            QMessageBox.warning(self, "Ошибка", "Введите название профиля!")
            return
        
        category = "private"
        
        # Check for duplicate names (using manager)
        profiles = self.main_window.profile_manager.profiles
        is_editing = self.editing_profile_index is not None
        
        for cat in ["private", "threads"]:
            for i, p in enumerate(profiles.get(cat, [])):
                if p["name"] == name:
                    # If editing, allow same name if it's the current profile
                    if is_editing and cat == self.editing_profile_category and i == self.editing_profile_index:
                        continue
                    QMessageBox.warning(self, "Ошибка", f"Профиль '{name}' уже существует!")
                    return
        
        proxy = self.proxy_input.text().strip() if self.proxy_radio.isChecked() else None
        test_ip = self.test_ip_checkbox.isChecked()
        profile_type = self.profile_type_combo.currentText()
        
        profile_data = {
            "name": name,
            "proxy": proxy,
            "test_ip": test_ip,
            "type": profile_type
        }
        
        if is_editing:
            # Update existing profile
            self.main_window.profile_manager.update_profile(self.editing_profile_category, self.editing_profile_index, profile_data)
            self.main_window.log(f"✏️ Обновлен профиль: {name}")
            self.cancel_edit() # Reset UI
        else:
            # Create new profile
            self.main_window.profile_manager.add_profile(category, profile_data)
            self.main_window.log(f"✅ Создан профиль: {name}")
            # Clear form
            self.reset_form()
            
        self.refresh_lists()

    def reset_form(self):
        """Clear inputs and reset state"""
        self.profile_name_input.clear()
        self.proxy_input.clear()
        self.test_ip_checkbox.setChecked(False)
        self.direct_radio.setChecked(True)
        self.profile_type_combo.setCurrentIndex(0)

    def load_profile_for_editing(self, category):
        list_widget = self.private_list if category == "private" else self.threads_list
        row = list_widget.currentRow()
        
        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для редактирования!")
            return
            
        profiles = self.main_window.profile_manager.profiles.get(category, [])
        if row >= len(profiles):
            return
            
        profile = profiles[row]
        
        # Set edit mode
        self.editing_profile_index = row
        self.editing_profile_category = category
        
        # Populate UI
        self.new_profile_group.setTitle(f"🟡 Редактирование: {profile['name']}")
        self.profile_name_input.setText(profile['name'])
        
        if profile.get('proxy'):
            self.proxy_radio.setChecked(True)
            self.proxy_input.setText(profile['proxy'])
            self.proxy_input.setEnabled(True)
        else:
            self.direct_radio.setChecked(True)
            self.proxy_input.clear()
            self.proxy_input.setEnabled(False)
            
        self.test_ip_checkbox.setChecked(profile.get('test_ip', False))
        
        # Set type combo
        ptype = profile.get('type', "Camoufox (рекомендуется)")
        index = self.profile_type_combo.findText(ptype)
        if index >= 0:
            self.profile_type_combo.setCurrentIndex(index)
            
        # Update buttons
        self.create_btn.setText("💾 Сохранить изменения")
        self.create_btn.setStyleSheet("background-color: #d4a017; padding: 12px; font-size: 14px; color: black;")
        self.cancel_edit_btn.setVisible(True)

    def cancel_edit(self):
        """Cancel editing and reset to create mode"""
        self.editing_profile_index = None
        self.editing_profile_category = None
        
        self.new_profile_group.setTitle("🟢 Новый Camoufox профиль")
        self.create_btn.setText("🔴 Создать профиль")
        self.create_btn.setStyleSheet("background-color: #333; padding: 12px; font-size: 14px;")
        self.cancel_edit_btn.setVisible(False)
        
        self.reset_form()

    def launch_profile(self, category):
        list_widget = self.private_list if category == "private" else self.threads_list
        row = list_widget.currentRow()
        
        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для запуска!")
            return
            
        profiles = self.main_window.profile_manager.profiles.get(category, [])
        if row >= len(profiles):
            return
            
        profile = profiles[row]
        name = profile['name']
        proxy = profile.get('proxy') or "None"
        
        if self.main_window.process_manager.is_running(name):
             QMessageBox.information(self, "Инфо", f"Профиль '{name}' уже запущен!")
             return
             
        success, msg = self.main_window.process_manager.start_profile(name, proxy)
        if success:
            self.main_window.log(f"🚀 Запущен профиль: {name}")
            # Sync status to database
            self.main_window.profile_manager.update_profile_status(name, "running", True)
            self.refresh_lists()
        else:
            QMessageBox.warning(self, "Ошибка", f"Не удалось запустить: {msg}")

    def stop_profile(self, category):
        list_widget = self.private_list if category == "private" else self.threads_list
        row = list_widget.currentRow()
        
        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для остановки!")
            return
            
        profiles = self.main_window.profile_manager.profiles.get(category, [])
        if row >= len(profiles):
            return
            
        profile = profiles[row]
        name = profile['name']
        
        if self.main_window.process_manager.stop_profile(name):
            self.main_window.log(f"⏹️ Остановлен профиль: {name}")
            # Sync status to database
            self.main_window.profile_manager.update_profile_status(name, "idle", False)
            self.refresh_lists()
        else:
            QMessageBox.information(self, "Инфо", f"Профиль '{name}' не запущен!")

    def delete_profile(self, category):
        list_widget = self.private_list if category == "private" else self.threads_list
        row = list_widget.currentRow()
        
        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для удаления!")
            return

        profiles = self.main_window.profile_manager.profiles.get(category, [])
        name = profiles[row]['name']

        # Stop if running
        if self.main_window.process_manager.is_running(name):
            self.stop_profile(category)

        confirm = QMessageBox.question(
            self, "Подтверждение", f"Удалить профиль '{name}'?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        
        if confirm == QMessageBox.StandardButton.Yes:
            self.main_window.profile_manager.delete_profile(category, row)
            self.refresh_lists()
            self.main_window.log(f"🗑️ Удален профиль: {name}")

    def generate_totp(self):
        secret = self.secret_input.text()
        
        try:
            code = generate_totp_code(secret)
            self.code_output.setText(code)
            self.main_window.log(f"🔑 Сгенерирован TOTP код: {code}")
        except ValueError as e:
            QMessageBox.warning(self, "Ошибка", str(e))
        except Exception as e:
            QMessageBox.warning(self, "Ошибка", f"Ошибка генерации: {e}")

    def copy_totp(self):
        code = self.code_output.text()
        if code:
            clipboard = QApplication.clipboard()
            clipboard.setText(code)
            self.main_window.log("📎 Код скопирован в буфер обмена")
        else:
            QMessageBox.warning(self, "Ошибка", "Сначала сгенерируйте код!")
