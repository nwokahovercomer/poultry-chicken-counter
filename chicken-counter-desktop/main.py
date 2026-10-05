"""
main.py

Chicken Counter — desktop app (Dear PyGui edition).

Workflow:
1. User selects a parent folder. Each subfolder inside it is treated
   as one "set" of images (expected: 3 images per set, same chickens
   from different angles).
2. Each image in a set is sent to the counting model.
3. The 3 per-image counts for a set are combined via rounded-mean
   voting into one count for that set.
4. Voted counts are summed across all sets for the grand total.
"""

import csv
import threading
from pathlib import Path

import dearpygui.dearpygui as dpg

from model_client import count_chickens_in_image
from voting import rounded_mean_vote

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}

# --- app state -----------------------------------------------------------
image_sets = []   # list of (set_name, [image paths])
results = []      # list of (set_name, counts, voted)
processing = False


def find_image_sets(parent_dir: str):
    """Each subfolder of parent_dir is treated as one set of images."""
    sets = []
    parent = Path(parent_dir)
    for sub in sorted(p for p in parent.iterdir() if p.is_dir()):
        images = sorted(
            p for p in sub.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS
        )
        if images:
            sets.append((sub.name, images))
    return sets


# --- callbacks -------------------------------------------------------------
def on_folder_selected(sender, app_data):
    global image_sets
    folder = app_data["file_path_name"]
    image_sets = find_image_sets(folder)

    dpg.delete_item("results_table", children_only=True, slot=1)  # clear rows, keep columns
    dpg.set_value("total_label", "Total chickens: —")
    dpg.configure_item("save_btn", enabled=False)
    dpg.set_value("progress", 0.0)
    dpg.configure_item("progress", overlay="0/0")

    if not image_sets:
        dpg.set_value(
            "folder_label",
            "No subfolders with images found. Expected structure: "
            "parent_folder/set_1/img1.jpg, img2.jpg, img3.jpg ..."
        )
        dpg.configure_item("process_btn", enabled=False)
        return

    mismatched = [name for name, imgs in image_sets if len(imgs) != 3]
    note = ""
    if mismatched:
        note = f"  (warning: {len(mismatched)} set(s) don't have exactly 3 images)"

    dpg.set_value("folder_label", f"{folder}  —  {len(image_sets)} set(s) found{note}")
    dpg.configure_item("process_btn", enabled=True)


def run_processing():
    """Runs on a background thread so the UI never freezes during API calls."""
    global results, processing
    results = []
    total = 0
    n = len(image_sets)

    for i, (set_name, images) in enumerate(image_sets, start=1):
        row = dpg.add_table_row(parent="results_table")
        try:
            counts = [count_chickens_in_image(str(p)) for p in images]
            voted = rounded_mean_vote(counts)
            total += voted
            results.append((set_name, counts, voted))
            dpg.add_text(set_name, parent=row)
            dpg.add_text(" / ".join(str(c) for c in counts), parent=row)
            dpg.add_text(str(voted), parent=row)
        except Exception as e:
            dpg.add_text(set_name, parent=row)
            dpg.add_text(f"ERROR: {e}", parent=row)
            dpg.add_text("—", parent=row)

        dpg.set_value("progress", i / n)
        dpg.configure_item("progress", overlay=f"{i}/{n}")

    dpg.set_value("total_label", f"Total chickens: {total}")
    dpg.configure_item("process_btn", enabled=True)
    dpg.configure_item("select_btn", enabled=True)
    dpg.configure_item("save_btn", enabled=len(results) > 0)
    processing = False


def on_process_clicked(sender, app_data):
    global processing
    if processing or not image_sets:
        return
    processing = True
    dpg.configure_item("process_btn", enabled=False)
    dpg.configure_item("select_btn", enabled=False)
    dpg.configure_item("save_btn", enabled=False)
    dpg.delete_item("results_table", children_only=True, slot=1)
    dpg.set_value("progress", 0.0)
    dpg.configure_item("progress", overlay="0/0")

    threading.Thread(target=run_processing, daemon=True).start()


def on_save_selected(sender, app_data):
    path = app_data["file_path_name"]
    if not path.lower().endswith(".csv"):
        path += ".csv"
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Set", "Per-image counts", "Voted count"])
        for set_name, counts, voted in results:
            writer.writerow([set_name, " / ".join(str(c) for c in counts), voted])
        writer.writerow([])
        writer.writerow(["TOTAL", "", sum(v for _, _, v in results)])
    dpg.set_value("folder_label", f"Report saved to {path}")


# --- UI setup ----------------------------------------------------------------
dpg.create_context()

with dpg.theme() as light_theme:
    with dpg.theme_component(dpg.mvAll):
        dpg.add_theme_color(dpg.mvThemeCol_WindowBg, (240, 240, 240))
        dpg.add_theme_color(dpg.mvThemeCol_Text, (20, 20, 20))
        dpg.add_theme_color(dpg.mvThemeCol_FrameBg, (255, 255, 255))
        dpg.add_theme_color(dpg.mvThemeCol_Button, (225, 225, 225))
        dpg.add_theme_color(dpg.mvThemeCol_ButtonHovered, (200, 200, 200))
        dpg.add_theme_color(dpg.mvThemeCol_ButtonActive, (180, 180, 180))
        dpg.add_theme_color(dpg.mvThemeCol_TableRowBg, (250, 250, 250))
        dpg.add_theme_color(dpg.mvThemeCol_TableRowBgAlt, (230, 230, 230))
        dpg.add_theme_color(dpg.mvThemeCol_TableHeaderBg, (210, 210, 210))
        dpg.add_theme_color(dpg.mvThemeCol_Border, (180, 180, 180))

dpg.bind_theme(light_theme)

with dpg.file_dialog(
    directory_selector=True, show=False, callback=on_folder_selected,
    tag="dir_dialog", width=650, height=420
):
    pass

with dpg.file_dialog(
    directory_selector=False, show=False, callback=on_save_selected,
    tag="save_dialog", default_filename="chicken_report.csv",
    width=650, height=420
):
    dpg.add_file_extension(".csv")

with dpg.window(tag="main_window"):
    with dpg.group(horizontal=True):
        dpg.add_button(
            label="Select Folder...", tag="select_btn",
            callback=lambda: dpg.show_item("dir_dialog")
        )
        dpg.add_button(
            label="Process", tag="process_btn",
            callback=on_process_clicked, enabled=False
        )
        dpg.add_button(
            label="Save Report (CSV)", tag="save_btn",
            callback=lambda: dpg.show_item("save_dialog"), enabled=False
        )

    dpg.add_spacer(height=8)
    dpg.add_text("No folder selected.", tag="folder_label")
    dpg.add_spacer(height=4)
    dpg.add_progress_bar(default_value=0.0, overlay="0/0", tag="progress", width=-1)
    dpg.add_spacer(height=8)

    with dpg.table(
        tag="results_table", header_row=True, resizable=True,
        borders_innerH=True, borders_outerH=True,
        borders_innerV=True, borders_outerV=True,
        height=300,
    ):
        dpg.add_table_column(label="Set")
        dpg.add_table_column(label="Per-image counts")
        dpg.add_table_column(label="Voted count")

    dpg.add_spacer(height=10)
    dpg.add_text("Total chickens: —", tag="total_label")

dpg.create_viewport(title="Chicken Counter", width=780, height=580)
dpg.setup_dearpygui()
dpg.show_viewport()
dpg.set_primary_window("main_window", True)
dpg.start_dearpygui()
dpg.destroy_context()
