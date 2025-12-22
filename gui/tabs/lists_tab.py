from PyQt6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QListWidget, QListWidgetItem, QLineEdit, QLabel, QFrame, QCheckBox
from PyQt6.QtCore import Qt
import requests
from supabase.config import PROJECT_URL, SECRET_KEY
from gui.styles import (
    INPUT_STYLE, PRIMARY_BTN_STYLE, BUTTON_STYLE, CARD_STYLE,
    ACTION_BTN_STYLE, CHECKBOX_STYLE, TAB_BACKGROUND_STYLE,
    TITLE_LABEL_STYLE, ACTION_BTN_SECONDARY_STYLE, ACTION_BTN_DANGER_STYLE
)
from gui.tabs.instagram.components import SettingsDialog

class ListsTab(QWidget):
    def __init__(self, main_window):
        super().__init__()
        self.main_window = main_window
        self.setStyleSheet(TAB_BACKGROUND_STYLE)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(20)

        header = QHBoxLayout()
        title = QLabel("Списки")
        title.setStyleSheet(TITLE_LABEL_STYLE)
        header.addWidget(title)
        header.addStretch()
        create_btn = QPushButton("+ Новый список")
        create_btn.setStyleSheet(PRIMARY_BTN_STYLE)
        create_btn.clicked.connect(self.show_create_list_dialog)
        header.addWidget(create_btn)
        layout.addLayout(header)

        card = QFrame()
        card.setStyleSheet(CARD_STYLE)
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(20, 20, 20, 20)
        self.list_widget = QListWidget()
        self.list_widget.setSpacing(8)
        card_layout.addWidget(self.list_widget)
        layout.addWidget(card)
        self.fetch_lists()

    def fetch_lists(self):
        if not PROJECT_URL or not SECRET_KEY:
            return
        try:
            r = requests.get(
                f"{PROJECT_URL}/rest/v1/lists",
                params={"select": "id,name", "order": "created_at.asc"},
                headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}", "Accept": "application/json"},
                timeout=20,
            )
            data = r.json() if r.status_code < 400 else []
        except:
            data = []
        self.list_widget.clear()
        for row in data:
            name = row.get("name") or ""
            list_id = row.get("id")
            it = QListWidgetItem()
            widget = self._create_item_widget(name, list_id)
            it.setSizeHint(widget.sizeHint())
            it.setData(Qt.ItemDataRole.UserRole, list_id)
            self.list_widget.addItem(it)
            self.list_widget.setItemWidget(it, widget)

    def show_create_list_dialog(self):
        dlg = SettingsDialog("Новый список", self)
        name_input = QLineEdit()
        name_input.setStyleSheet(INPUT_STYLE)
        save_btn = QPushButton("Создать")
        save_btn.setStyleSheet(PRIMARY_BTN_STYLE)

        def do_create():
            name = name_input.text().strip()
            if not name or not PROJECT_URL or not SECRET_KEY:
                dlg.close()
                return
            try:
                requests.post(
                    f"{PROJECT_URL}/rest/v1/lists",
                    json={"name": name},
                    headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"},
                    timeout=20,
                )
            except:
                pass
            dlg.close()
            self.fetch_lists()

        save_btn.clicked.connect(do_create)
        dlg.add_widget(name_input)
        dlg.add_widget(save_btn)
        dlg.exec()

    def delete_selected(self):
        it = self.list_widget.currentItem()
        if not it or not PROJECT_URL or not SECRET_KEY:
            return
        list_id = it.data(Qt.ItemDataRole.UserRole)
        if not list_id:
            self.fetch_lists()
            return
        try:
            requests.delete(
                f"{PROJECT_URL}/rest/v1/lists?id=eq.{list_id}",
                headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}"},
                timeout=20,
            )
        except:
            pass
        self.fetch_lists()

    def edit_selected(self):
        it = self.list_widget.currentItem()
        if not it or not PROJECT_URL or not SECRET_KEY:
            return
        list_id = it.data(Qt.ItemDataRole.UserRole)
        if not list_id:
            return
        w = self.list_widget.itemWidget(it)
        name_label = w.findChild(QLabel, "profileName") if w else None
        name = name_label.text() if name_label else ""
        self.open_edit_dialog(list_id, name)

    def _create_item_widget(self, name, list_id):
        frame = QFrame()
        frame.setStyleSheet(CARD_STYLE)
        frame.setFixedHeight(55)
        h = QHBoxLayout(frame)
        h.setContentsMargins(10, 4, 10, 4)
        name_label = QLabel(name)
        name_label.setObjectName("profileName")
        h.addWidget(name_label)
        h.addStretch()
        edit_btn = QPushButton("⚙")
        edit_btn.setToolTip("Редактировать")
        edit_btn.setStyleSheet(ACTION_BTN_SECONDARY_STYLE)
        delete_btn = QPushButton("🗑")
        delete_btn.setToolTip("Удалить")
        delete_btn.setStyleSheet(ACTION_BTN_DANGER_STYLE)

        def open_edit():
            self.open_edit_dialog(list_id, name)

        def do_delete():
            try:
                requests.delete(
                    f"{PROJECT_URL}/rest/v1/lists?id=eq.{list_id}",
                    headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}"},
                    timeout=20,
                )
            except:
                pass
            self.fetch_lists()

        edit_btn.clicked.connect(open_edit)
        delete_btn.clicked.connect(do_delete)
        h.addWidget(edit_btn)
        h.addWidget(delete_btn)
        return frame

    def open_edit_dialog(self, list_id, current_name):
        dlg = SettingsDialog("Редактировать список", self)
        name_input = QLineEdit(current_name)
        name_input.setStyleSheet(INPUT_STYLE)
        accounts_frame = QFrame()
        accounts_frame.setStyleSheet(CARD_STYLE)
        accounts_layout = QVBoxLayout(accounts_frame)
        accounts_layout.setContentsMargins(15, 15, 15, 15)
        account_controls = []
        try:
            r1 = requests.get(
                f"{PROJECT_URL}/rest/v1/profiles",
                params={"select": "profile_id,name", "list_id": "is.null", "order": "created_at.asc"},
                headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}", "Accept": "application/json"},
                timeout=20,
            )
            unassigned = r1.json() if r1.status_code < 400 else []
        except:
            unassigned = []
        try:
            r2 = requests.get(
                f"{PROJECT_URL}/rest/v1/profiles",
                params={"select": "profile_id,name", "list_id": f"eq.{list_id}", "order": "created_at.asc"},
                headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}", "Accept": "application/json"},
                timeout=20,
            )
            assigned = r2.json() if r2.status_code < 400 else []
        except:
            assigned = []
        for row in assigned + unassigned:
            cb = QCheckBox(row.get("name") or "")
            cb.setStyleSheet(CHECKBOX_STYLE)
            cb.setChecked(row in assigned)
            account_controls.append((cb, row.get("profile_id"), row in assigned))
            accounts_layout.addWidget(cb)
        save_btn = QPushButton("Сохранить")
        save_btn.setStyleSheet(PRIMARY_BTN_STYLE)
        def do_save():
            new_name = name_input.text().strip()
            if new_name and new_name != current_name:
                try:
                    requests.patch(
                        f"{PROJECT_URL}/rest/v1/lists?id=eq.{list_id}",
                        json={"name": new_name},
                        headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}", "Content-Type": "application/json"},
                        timeout=20,
                    )
                except:
                    pass
            for cb, acc_id, was_assigned in account_controls:
                now = cb.isChecked()
                if now and not was_assigned:
                    try:
                        requests.patch(
                            f"{PROJECT_URL}/rest/v1/profiles?profile_id=eq.{acc_id}",
                            json={"list_id": list_id},
                            headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}", "Content-Type": "application/json"},
                            timeout=20,
                        )
                    except:
                        pass
                if (not now) and was_assigned:
                    try:
                        requests.patch(
                            f"{PROJECT_URL}/rest/v1/profiles?profile_id=eq.{acc_id}",
                            json={"list_id": None},
                            headers={"apikey": SECRET_KEY, "Authorization": f"Bearer {SECRET_KEY}", "Content-Type": "application/json"},
                            timeout=20,
                        )
                    except:
                        pass
            dlg.close()
            self.fetch_lists()
        save_btn.clicked.connect(do_save)
        dlg.add_widget(name_input)
        dlg.add_widget(accounts_frame)
        dlg.add_widget(save_btn)
        dlg.exec()
