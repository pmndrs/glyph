//! Runs the layout oracle's quick tier: every quick case against the frozen reference set, and
//! the seeded differential against cold layout. `cargo test --release --features oracle --test
//! layout_oracle`; the full tier is `layout-oracle check --tier full`.

use std::process::Command;

#[test]
fn quick_tier_equals_the_frozen_reference_and_cold_layout() {
    let output = Command::new(env!("CARGO_BIN_EXE_layout-oracle"))
        .args(["check", "--tier", "quick"])
        .output()
        .expect("run layout-oracle");
    let report = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "layout oracle quick tier failed:\n{report}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    // A pass with nothing compared is not a pass.
    assert!(report.contains("0 differ, 0 skipped"), "{report}");
}
