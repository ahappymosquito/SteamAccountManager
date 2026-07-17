// Windows desktop binary entry point.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    steam_account_manager_lib::run();
}
