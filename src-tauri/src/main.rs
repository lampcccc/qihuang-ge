// 桌面端入口（Tauri 2）。需先安装 Rust 工具链后执行 `bun run tauri dev/build`。
// 运行桌面端前，请确保本地 Bun 后端（端口 3801）已启动：bun run server
fn main() {
    qihuangge_lib::run()
}
