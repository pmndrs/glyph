//! Structural facts about the glyph Rust tree, one JSON object per line.
//!
//! Review questions about this codebase are structural — "which functions allocate inside a
//! loop", "which `unsafe fn` carry a `# Safety` section", "which columns of an arena are
//! mutated where" — and a regex cannot answer them, because it cannot see loop nesting,
//! `#[cfg(test)]` scope, or the difference between a method call and a macro. This parses every
//! file with `syn` and emits the facts, so those questions are answered against a parse tree.
//!
//! What it deliberately does NOT do: resolve types. `syn` is a parser, not a compiler, so a
//! `.clone()` here is a method name and nothing more — `Range<usize>::clone()` is free while
//! `Vec<u8>::clone()` allocates, and this tool cannot tell them apart. Fields that depend on
//! type knowledge are named so the caller remembers to check: see `alloc_in_loop`, whose
//! `clone`/`join` entries must be read before they are believed.
//!
//! ```text
//! ast-facts <root> > facts.jsonl
//! ```

use std::{collections::BTreeMap, env, fs, path::Path};

use proc_macro2::Span;
use quote::ToTokens;
use syn::{
    Attribute, Expr, ExprMethodCall, File, ImplItemFn, Item, ItemFn, ItemStruct, Meta, Type,
    spanned::Spanned,
    visit::{self, Visit},
};
use walkdir::WalkDir;

/// Method names that always allocate. `collect` is included even though it can target a
/// non-allocating collection, because that is rare enough to be worth reporting.
const DEFINITE_ALLOCATION: &[&str] = &[
    "to_vec",
    "to_owned",
    "to_string",
    "into_vec",
    "collect",
    "repeat",
    "concat",
];

/// Method names that allocate only for some receiver types. Reported separately so a reader
/// knows to resolve the type before acting: `Range::clone` is two `usize` copies, `Vec::clone`
/// is an allocation, and `join` is a bounds union on some local types and a `String` on slices.
const TYPE_DEPENDENT: &[&str] = &["clone", "join"];

/// Methods that reuse an existing allocation — the codebase's steady-state vocabulary.
const REUSE: &[&str] = &[
    "clear",
    "truncate",
    "extend_from_slice",
    "copy_from_slice",
    "fill",
];

/// Methods that abort the module under `panic = "abort"` when they fail.
const PANICKING: &[&str] = &["unwrap", "expect"];

#[derive(Default)]
struct FnFacts {
    loop_depth: usize,
    max_loop_depth: usize,
    definite_alloc_in_loop: Vec<(String, usize)>,
    type_dependent_in_loop: Vec<(String, usize)>,
    alloc_total: usize,
    reuse_total: usize,
    unsafe_blocks: usize,
    casts: BTreeMap<String, usize>,
    checked: usize,
    saturating: usize,
    wrapping: usize,
    try_ops: usize,
    index_exprs: usize,
    panicky: Vec<(String, usize)>,
    calls: usize,
}

impl FnFacts {
    fn enter_loop(&mut self) {
        self.loop_depth += 1;
        self.max_loop_depth = self.max_loop_depth.max(self.loop_depth);
    }
}

impl<'ast> Visit<'ast> for FnFacts {
    fn visit_expr_for_loop(&mut self, node: &'ast syn::ExprForLoop) {
        self.enter_loop();
        visit::visit_expr_for_loop(self, node);
        self.loop_depth -= 1;
    }

    fn visit_expr_while(&mut self, node: &'ast syn::ExprWhile) {
        self.enter_loop();
        visit::visit_expr_while(self, node);
        self.loop_depth -= 1;
    }

    fn visit_expr_loop(&mut self, node: &'ast syn::ExprLoop) {
        self.enter_loop();
        visit::visit_expr_loop(self, node);
        self.loop_depth -= 1;
    }

    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        let name = node.method.to_string();
        let line = node.method.span().start().line;
        self.calls += 1;

        if DEFINITE_ALLOCATION.contains(&name.as_str()) {
            self.alloc_total += 1;
            if self.loop_depth > 0 {
                self.definite_alloc_in_loop.push((name.clone(), line));
            }
        }
        if TYPE_DEPENDENT.contains(&name.as_str()) && self.loop_depth > 0 {
            self.type_dependent_in_loop.push((name.clone(), line));
        }
        if REUSE.contains(&name.as_str()) {
            self.reuse_total += 1;
        }
        if PANICKING.contains(&name.as_str()) {
            self.panicky.push((name.clone(), line));
        }

        if let Some(rest) = name.strip_prefix("checked_") {
            let _ = rest;
            self.checked += 1;
        } else if name.starts_with("saturating_") {
            self.saturating += 1;
        } else if name.starts_with("wrapping_") || name.starts_with("overflowing_") {
            self.wrapping += 1;
        }

        visit::visit_expr_method_call(self, node);
    }

    fn visit_expr_cast(&mut self, node: &'ast syn::ExprCast) {
        if let Type::Path(path) = &*node.ty
            && let Some(segment) = path.path.segments.last()
        {
            *self.casts.entry(segment.ident.to_string()).or_default() += 1;
        }
        visit::visit_expr_cast(self, node);
    }

    fn visit_expr_unsafe(&mut self, node: &'ast syn::ExprUnsafe) {
        self.unsafe_blocks += 1;
        visit::visit_expr_unsafe(self, node);
    }

    fn visit_expr_try(&mut self, node: &'ast syn::ExprTry) {
        self.try_ops += 1;
        visit::visit_expr_try(self, node);
    }

    fn visit_expr_index(&mut self, node: &'ast syn::ExprIndex) {
        self.index_exprs += 1;
        visit::visit_expr_index(self, node);
    }

    /// A nested item owns its own scope; its facts belong to itself, not to the enclosing body.
    fn visit_item(&mut self, _node: &'ast Item) {}
}

fn is_cfg_test(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attribute| {
        let Meta::List(list) = &attribute.meta else {
            return false;
        };
        list.path.is_ident("cfg") && list.tokens.to_string().replace(' ', "").contains("test")
    })
}

fn has_safety_doc(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attribute| {
        let Meta::NameValue(pair) = &attribute.meta else {
            return false;
        };
        if !pair.path.is_ident("doc") {
            return false;
        }
        let Expr::Lit(literal) = &pair.value else {
            return false;
        };
        let syn::Lit::Str(text) = &literal.lit else {
            return false;
        };
        text.value().to_lowercase().contains("# safety")
    })
}

fn pairs(entries: &[(String, usize)]) -> Vec<serde_json::Value> {
    entries
        .iter()
        .map(|(method, line)| serde_json::json!({ "method": method, "line": line }))
        .collect()
}

struct Emitter<'a> {
    file: &'a str,
    krate: &'a str,
    integration_test: bool,
}

impl Emitter<'_> {
    #[allow(clippy::too_many_arguments)]
    fn function(
        &self,
        name: &str,
        span: Span,
        end_line: usize,
        is_unsafe: bool,
        is_pub: bool,
        extern_c: bool,
        attrs: &[Attribute],
        facts: &FnFacts,
    ) {
        let start = span.start().line;
        println!(
            "{}",
            serde_json::json!({
                "kind": "fn",
                "crate": self.krate,
                "file": self.file,
                "line": start,
                "end_line": end_line,
                "loc": end_line.saturating_sub(start) + 1,
                "name": name,
                "test": self.integration_test,
                "unsafe": is_unsafe,
                "pub": is_pub,
                "extern_c": extern_c,
                "safety_doc": has_safety_doc(attrs),
                "max_loop_depth": facts.max_loop_depth,
                "definite_alloc_in_loop": pairs(&facts.definite_alloc_in_loop),
                "type_dependent_in_loop": pairs(&facts.type_dependent_in_loop),
                "alloc_total": facts.alloc_total,
                "reuse_total": facts.reuse_total,
                "unsafe_blocks": facts.unsafe_blocks,
                "casts": facts.casts,
                "checked": facts.checked,
                "saturating": facts.saturating,
                "wrapping": facts.wrapping,
                "try_ops": facts.try_ops,
                "index_exprs": facts.index_exprs,
                "panicky": pairs(&facts.panicky),
                "calls": facts.calls,
            })
        );
    }

    fn structure(&self, item: &ItemStruct) {
        let mut vec_fields = Vec::new();
        let mut fields = Vec::new();
        for field in &item.fields {
            let ty = field.ty.to_token_stream().to_string().replace(' ', "");
            let name = field
                .ident
                .as_ref()
                .map_or_else(String::new, ToString::to_string);
            if ty.starts_with("Vec<") {
                vec_fields.push(name.clone());
            }
            fields.push(serde_json::json!({
                "name": name,
                "ty": ty,
                "pub": matches!(field.vis, syn::Visibility::Public(_)),
            }));
        }
        let reprs: Vec<String> = item
            .attrs
            .iter()
            .filter_map(|attribute| {
                let Meta::List(list) = &attribute.meta else {
                    return None;
                };
                list.path
                    .is_ident("repr")
                    .then(|| list.tokens.to_string().replace(' ', ""))
            })
            .collect();
        println!(
            "{}",
            serde_json::json!({
                "kind": "struct",
                "crate": self.krate,
                "file": self.file,
                "line": item.span().start().line,
                "name": item.ident.to_string(),
                "repr": reprs,
                "field_count": fields.len(),
                "vec_field_count": vec_fields.len(),
                "vec_fields": vec_fields,
                "fields": fields,
            })
        );
    }
}

fn body_facts(block: &syn::Block) -> FnFacts {
    let mut facts = FnFacts::default();
    for statement in &block.stmts {
        facts.visit_stmt(statement);
    }
    facts
}

impl<'ast> Visit<'ast> for Emitter<'_> {
    fn visit_item(&mut self, item: &'ast Item) {
        match item {
            Item::Fn(ItemFn {
                attrs,
                vis,
                sig,
                block,
            }) => {
                if is_cfg_test(attrs) {
                    return;
                }
                self.function(
                    &sig.ident.to_string(),
                    item.span(),
                    block.span().end().line,
                    sig.unsafety.is_some(),
                    matches!(vis, syn::Visibility::Public(_)),
                    sig.abi.is_some(),
                    attrs,
                    &body_facts(block),
                );
                return;
            }
            Item::Struct(structure) => self.structure(structure),
            Item::Mod(module) if is_cfg_test(&module.attrs) => return,
            Item::Impl(block) => {
                for entry in &block.items {
                    if let syn::ImplItem::Fn(ImplItemFn {
                        attrs,
                        vis,
                        sig,
                        block,
                        ..
                    }) = entry
                    {
                        if is_cfg_test(attrs) {
                            continue;
                        }
                        self.function(
                            &sig.ident.to_string(),
                            entry.span(),
                            block.span().end().line,
                            sig.unsafety.is_some(),
                            matches!(vis, syn::Visibility::Public(_)),
                            sig.abi.is_some(),
                            attrs,
                            &body_facts(block),
                        );
                    }
                }
                return;
            }
            _ => {}
        }
        visit::visit_item(self, item);
    }
}

fn main() {
    let root = env::args().nth(1).unwrap_or_else(|| ".".to_owned());
    let root_path = Path::new(&root);
    let mut failures = 0_usize;

    for entry in WalkDir::new(root_path).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "rs") {
            continue;
        }
        let display = path.to_string_lossy();
        // `target/` is build output, and this crate is the tool itself.
        if display.contains("/target/") || display.contains("/ast-facts/") {
            continue;
        }
        let Ok(source) = fs::read_to_string(path) else {
            continue;
        };
        let parsed: File = match syn::parse_file(&source) {
            Ok(parsed) => parsed,
            Err(error) => {
                eprintln!("{display}: {error}");
                failures += 1;
                continue;
            }
        };
        let relative = path
            .strip_prefix(root_path)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();
        let krate = relative.split('/').next().unwrap_or("unknown").to_owned();
        let integration_test = relative.contains("/tests/");
        Emitter {
            file: &relative,
            krate: &krate,
            integration_test,
        }
        .visit_file(&parsed);
    }

    if failures > 0 {
        eprintln!("{failures} file(s) failed to parse");
    }
}
