from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QListWidget, QGroupBox, QMessageBox, QScrollArea, QFrame,
    QRadioButton, QButtonGroup, QCheckBox, QComboBox, QLineEdit, QListWidgetItem, QApplication,
    QDialog, QDialogButtonBox
)
from PyQt6.QtCore import Qt
from utils.totp import generate_totp_code


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
        self.resize(500, 400)

        # Form elements
        self.profile_name_input = QLineEdit()
        self.profile_name_input.setPlaceholderText("Введите название профиля")

        self.profile_type_combo = QComboBox()
        self.profile_type_combo.addItems(["Camoufox (рекомендуется)", "Standard Firefox"])

        self.proxy_radio = QRadioButton("🔴 PROXY")
        self.direct_radio = QRadioButton("🟢 Прямое подключение")
        self.direct_radio.setChecked(True)

        self.connection_group = QButtonGroup()
        self.connection_group.addButton(self.proxy_radio)
        self.connection_group.addButton(self.direct_radio)

        self.proxy_input = QLineEdit()
        self.proxy_input.setPlaceholderText("ip:port:login:pass или socks5://ip:port:login:pass")
        self.proxy_input.setEnabled(False)

        self.test_ip_checkbox = QCheckBox("🟢 Тестировать IP при запуске")

        # Connect signals
        self.proxy_radio.toggled.connect(self.toggle_proxy_input)

        # Pre-fill form if editing
        if editing_profile:
            self.load_profile_data(editing_profile)

        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)

        # Profile Name Row
        name_row = QHBoxLayout()
        name_label = QLabel("📝 Название профиля:")
        name_row.addWidget(name_label, 1)
        name_row.addWidget(self.profile_name_input, 3)
        layout.addLayout(name_row)

        # Profile Type Row
        type_row = QHBoxLayout()
        type_label = QLabel("⚙️ Тип профиля:")
        type_row.addWidget(type_label, 1)
        type_row.addWidget(self.profile_type_combo, 3)
        layout.addLayout(type_row)

        # Connection Settings Group
        conn_group = QGroupBox("⚡ Настройки подключения")
        conn_layout = QVBoxLayout(conn_group)

        # Connection Mode Row
        mode_row = QHBoxLayout()
        mode_label = QLabel("⚡ Режим:")
        mode_row.addWidget(mode_label)
        mode_row.addWidget(self.proxy_radio)
        mode_row.addWidget(self.direct_radio)
        mode_row.addStretch()
        conn_layout.addLayout(mode_row)

        # Proxy String Row
        proxy_row = QHBoxLayout()
        proxy_label = QLabel("🔑 PROXY строка:")
        proxy_row.addWidget(proxy_label, 1)
        proxy_row.addWidget(self.proxy_input, 3)
        conn_layout.addLayout(proxy_row)

        # Test IP Checkbox
        conn_layout.addWidget(self.test_ip_checkbox)

        layout.addWidget(conn_group)

        # Dialog buttons
        if self.editing_profile:
            buttons = QDialogButtonBox(
                QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
            )
            buttons.button(QDialogButtonBox.StandardButton.Save).setText("💾 Сохранить изменения")
        else:
            buttons = QDialogButtonBox(
                QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
            )
            buttons.button(QDialogButtonBox.StandardButton.Ok).setText("🔴 Создать профиль")

        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def toggle_proxy_input(self, checked):
        """Enable/disable proxy input based on radio selection"""
        self.proxy_input.setEnabled(checked)
        if not checked:
            self.proxy_input.clear()

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

        # Set test IP checkbox
        self.test_ip_checkbox.setChecked(profile.get('test_ip', False))

    def get_profile_data(self):
        """Get profile data from form"""
        name = self.profile_name_input.text().strip()
        if not name:
            raise ValueError("Введите название профиля!")

        proxy = self.proxy_input.text().strip() if self.proxy_radio.isChecked() else None
        test_ip = self.test_ip_checkbox.isChecked()
        profile_type = self.profile_type_combo.currentText()

        return {
            "name": name,
            "proxy": proxy,
            "test_ip": test_ip,
            "type": profile_type
        }

    def set_editing_index(self, category, index):
        """Set editing context for validation"""
        self.editing_category = category
        self.editing_index = index


class ProfilesTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window # Reference to main window for log/managers
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

        # === CREATE PROFILE BUTTON ===
        create_section = QGroupBox("🟢 Создание профиля")
        create_layout = QVBoxLayout(create_section)

        self.create_profile_btn = QPushButton("🔴 Создать новый профиль")
        self.create_profile_btn.setStyleSheet("background-color: #333; padding: 12px; font-size: 14px;")
        self.create_profile_btn.clicked.connect(self.show_create_profile_dialog)
        create_layout.addWidget(self.create_profile_btn)

        layout.addWidget(create_section)

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
        
        mgmt_layout.addLayout(left_panel)
        
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
        """Refresh private profile list"""
        self.private_list.clear()

        # Get profiles from manager
        profiles = self.main_window.profile_manager.profiles

        for profile in profiles.get("private", []):
            status = "🟢 Running" if self.main_window.process_manager.is_running(profile["name"]) else "⚫ Idle"
            proxy_info = f" | Proxy: {profile.get('proxy', 'Direct')[:30]}..." if profile.get('proxy') else ""
            item = QListWidgetItem(f"{profile['name']} {status}{proxy_info}")
            self.private_list.addItem(item)

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

    def create_profile(self):
        """Legacy method - kept for compatibility, but creation now uses dialog"""
        pass

    def load_profile_for_editing(self, category):
        """Load private profile for editing using the dialog"""
        if category != "private":
            return

        row = self.private_list.currentRow()

        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для редактирования!")
            return

        profiles = self.main_window.profile_manager.profiles.get("private", [])
        if row >= len(profiles):
            return

        profile = profiles[row]
        self.show_create_profile_dialog(profile, "private", row)

    def launch_profile(self, category):
        """Launch a private profile"""
        if category != "private":
            return

        row = self.private_list.currentRow()

        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для запуска!")
            return

        profiles = self.main_window.profile_manager.profiles.get("private", [])
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
        """Stop a private profile"""
        if category != "private":
            return

        row = self.private_list.currentRow()

        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для остановки!")
            return

        profiles = self.main_window.profile_manager.profiles.get("private", [])
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
        """Delete a private profile"""
        if category != "private":
            return

        row = self.private_list.currentRow()

        if row < 0:
            QMessageBox.warning(self, "Ошибка", "Выберите профиль для удаления!")
            return

        profiles = self.main_window.profile_manager.profiles.get("private", [])
        name = profiles[row]['name']

        # Stop if running
        if self.main_window.process_manager.is_running(name):
            self.stop_profile(category)

        confirm = QMessageBox.question(
            self, "Подтверждение", f"Удалить профиль '{name}'?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if confirm == QMessageBox.StandardButton.Yes:
            self.main_window.profile_manager.delete_profile("private", row)
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
