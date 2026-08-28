import path from 'node:path';

export const metadata = Object.freeze({ id: '2026-08-28-id-factory' });

const DIRECT_HELPERS = new Map([
  ['techniqueId', 'technique'],
  ['programId', 'program'],
  ['resourceId', 'resource'],
]);

const GLYPH_DOMAINS = new Map([
  ['buffer', 'buffer'],
  ['policy', 'policy'],
  ['font-binding', 'fontBinding'],
  ['font-stack', 'fontStack'],
  ['retained-plan', 'retainedPlan'],
  ['material', 'material'],
  ['paragraph', 'paragraph'],
  ['style', 'style'],
  ['flow-thread', 'flowThread'],
  ['region', 'region'],
  ['exclusion', 'exclusion'],
  ['inline-object', 'inlineObject'],
  ['resource', 'resourceHandle'],
]);

const REGISTRY_METHODS = new Map([
  ['techniqueId', 'technique'],
  ['programId', 'program'],
  ['resourceId', 'resource'],
]);
const ID_METHODS = new Set([...GLYPH_DOMAINS.values(), ...DIRECT_HELPERS.values()]);
const ID_FACTORY_CONSUMERS = new Set(['compileRasterFont', 'readCompiledRasterFont']);

export function transform({ project, tsMorph }) {
  renameRasterPolicyOption(project, tsMorph);
  renamePublicIdParameters(project, tsMorph);
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    renameKnownRenderIdAccesses(sourceFile, tsMorph);
    const glyphImports = sourceFile
      .getImportDeclarations()
      .filter((declaration) => isGlyphModule(sourceFile, declaration.getModuleSpecifierValue()));
    if (glyphImports.length === 0) continue;
    const glyphSource = normalize(sourceFile.getFilePath()).includes('/packages/glyph/src/');
    const javascript = /\.m?js$/.test(sourceFile.getFilePath());

    const imports = new Map();
    for (const specifier of glyphImports.flatMap((declaration) => declaration.getNamedImports())) {
      imports.set(specifier.getName(), {
        local: specifier.getAliasNode()?.getText() ?? specifier.getName(),
        specifier,
      });
    }
    const importedId = imports.get('id');
    const registryLocal = imports.get('RenderWireIdentityRegistry')?.local;
    const needsIdUtility =
      importedId !== undefined ||
      registryLocal !== undefined ||
      [...DIRECT_HELPERS.keys()].some((name) => imports.has(name));
    if (imports.has('renderWireId')) {
      throw new TypeError(
        `cannot infer the domain of renderWireId() in ${sourceFile.getFilePath()}; choose id.technique, id.program, id.resource, or id(name)`,
      );
    }
    const shadowsId = needsIdUtility && needsIdAlias(sourceFile, imports, tsMorph);
    if (!needsIdUtility) {
      for (const access of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
        if (
          access.getExpression().getText() === 'glyphId' &&
          ID_METHODS.has(access.getName()) &&
          isInsideIdBinding(access, tsMorph)
        ) {
          access.getExpression().replaceWithText('id');
        }
      }
    }
    if (importedId?.local === 'glyphId' && !shadowsId) {
      importedId.specifier.removeAliasWithRename();
      importedId.local = 'id';
    }
    const idLocal =
      importedId?.local === 'id' && shadowsId ? 'glyphId' : (importedId?.local ?? (shadowsId ? 'glyphId' : 'id'));
    if (importedId?.local === 'id' && shadowsId) {
      importedId.specifier.setAlias(idLocal);
      for (const access of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
        if (access.getExpression().getText() === 'id' && ID_METHODS.has(access.getName())) {
          access.getExpression().replaceWithText(idLocal);
        }
      }
      for (const call of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
        if (call.getExpression().getText() === 'id') call.getExpression().replaceWithText(idLocal);
        if (!ID_FACTORY_CONSUMERS.has(call.getExpression().getText()) || !isInsideIdBinding(call, tsMorph)) continue;
        for (const argument of call.getArguments()) {
          if (argument.getText() === 'id') argument.replaceWithText(idLocal);
        }
      }
    }
    if (idLocal !== 'id') {
      for (const declaration of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)) {
        if (declaration.getInitializer()?.getText() === 'id') declaration.setInitializer(idLocal);
      }
      for (const access of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
        if (access.getExpression().getText() === 'id' && ID_METHODS.has(access.getName())) {
          access.getExpression().replaceWithText(idLocal);
        }
      }
      for (const call of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
        if (!ID_FACTORY_CONSUMERS.has(call.getExpression().getText())) continue;
        for (const argument of call.getArguments()) {
          if (argument.getText() === 'id') argument.replaceWithText(idLocal);
        }
      }
    }
    const registryBindings = collectRegistryBindings(sourceFile, registryLocal, tsMorph);
    renameInlineRasterPolicyOptions(sourceFile, imports.get('createRasterPolicyProgram')?.local, tsMorph);

    for (const call of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!tsMorph.Node.isIdentifier(expression)) continue;
      const expressionName = expression.getText();
      if (expression.getText() === idLocal) {
        const [kind, ...rest] = call.getArguments();
        if (!tsMorph.Node.isStringLiteral(kind)) continue;
        const method = GLYPH_DOMAINS.get(kind.getLiteralText());
        if (method === undefined) continue;
        call.replaceWithText(`${idLocal}.${method}(${rest.map((argument) => argument.getText()).join(', ')})`);
        continue;
      }
      for (const [helper, method] of DIRECT_HELPERS) {
        if (expressionName !== imports.get(helper)?.local) continue;
        expression.replaceWithText(`${idLocal}.${method}`);
        break;
      }
    }

    for (const access of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
      const method = REGISTRY_METHODS.get(access.getName());
      if (method === undefined) continue;
      const receiver = access.getExpression();
      if (!tsMorph.Node.isIdentifier(receiver) || !isRegistryReceiver(receiver, registryBindings)) continue;
      access.getNameNode().replaceWithText(method);
    }

    if (registryLocal !== undefined && !glyphSource) {
      for (const expression of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.NewExpression)) {
        if (expression.getExpression().getText() === registryLocal) expression.replaceWithText(idLocal);
      }
    }

    const usedFormerHelper = [...DIRECT_HELPERS].some(([name]) => imports.has(name));
    for (const name of DIRECT_HELPERS.keys()) imports.get(name)?.specifier.remove();
    const registryImport = imports.get('RenderWireIdentityRegistry')?.specifier;
    if (registryImport !== undefined) {
      if (!glyphSource && !hasRegistryUse(sourceFile, registryLocal, tsMorph)) {
        removeImportSpecifier(registryImport);
      } else renameRegistryImport(registryImport, glyphSource, javascript);
    }
    if (needsIdUtility || usedFormerHelper || (!glyphSource && registryLocal !== undefined)) {
      ensureIdImport(glyphImports, idLocal, sourceFile);
    }
  }
}

function hasRegistryUse(sourceFile, local, tsMorph) {
  if (local === undefined) return false;
  return sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.Identifier).some((identifier) => {
    if (identifier.getText() !== local) return false;
    return !identifier.getAncestors().some((ancestor) => tsMorph.Node.isImportSpecifier(ancestor));
  });
}

function renamePublicIdParameters(project, tsMorph) {
  const targets = [
    [
      '/packages/glyph/src/core/raster-plan-program.ts',
      [
        ['compileRasterFont', 1, 'identities'],
        ['readCompiledRasterFont', 2, 'identities'],
      ],
    ],
    [
      '/packages/glyph/src/three/render-policy.ts',
      [
        ['threeRenderPolicyBytes', 0, 'identityRegistry'],
        ['threeRenderPolicyDescriptor', 0, 'identityRegistry'],
      ],
    ],
    [
      '/packages/glyph-example-renderer/src/policy.ts',
      [
        ['exampleRenderPolicyBytes', 0, 'identities'],
        ['exampleRenderPolicyDescriptor', 0, 'identities'],
      ],
    ],
  ];
  for (const [suffix, functions] of targets) {
    const source = project.getSourceFile((file) => normalize(file.getFilePath()).endsWith(suffix));
    for (const [name, index, legacy] of functions) {
      const declaration = source?.getFunction(name);
      const parameter = declaration?.getParameters()[index];
      if (parameter === undefined || declaration === undefined) continue;
      if (parameter.getName() !== 'ids') renameLocalBinding(parameter, 'ids', tsMorph);
      else repairLegacyParameterReferences(declaration, legacy, tsMorph);
    }
  }
}

function renameRasterPolicyOption(project, tsMorph) {
  const source = project.getSourceFile((file) =>
    normalize(file.getFilePath()).endsWith('/packages/glyph/src/core/raster-plan-program.ts'),
  );
  const property = source?.getInterface('RasterPolicyProgramOptions')?.getProperty('identityRegistry');
  if (property === undefined || source === undefined) return;
  property.getNameNode().replaceWithText('ids');
  for (const access of source.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
    if (access.getName() === 'identityRegistry') access.getNameNode().replaceWithText('ids');
  }
}

function renameLocalBinding(declaration, replacement, tsMorph) {
  const name = declaration.getNameNode();
  const symbol = name.getSymbol()?.compilerSymbol;
  if (symbol === undefined) throw new TypeError(`cannot resolve local codemod binding ${declaration.getName()}`);
  const source = declaration.getSourceFile();
  const references = source
    .getDescendantsOfKind(tsMorph.SyntaxKind.Identifier)
    .filter((identifier) => identifier.getSymbol()?.compilerSymbol === symbol);
  for (const identifier of references.reverse()) identifier.replaceWithText(replacement);
}

function repairLegacyParameterReferences(declaration, legacy, tsMorph) {
  for (const identifier of declaration.getDescendantsOfKind(tsMorph.SyntaxKind.Identifier).reverse()) {
    if (identifier.getText() === legacy) identifier.replaceWithText('ids');
  }
}

function renameInlineRasterPolicyOptions(sourceFile, localName, tsMorph) {
  if (localName === undefined) return;
  for (const call of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== localName) continue;
    let options = call.getArguments()[1];
    while (
      tsMorph.Node.isAsExpression(options) ||
      tsMorph.Node.isSatisfiesExpression(options) ||
      tsMorph.Node.isParenthesizedExpression(options)
    ) {
      options = options.getExpression();
    }
    if (!tsMorph.Node.isObjectLiteralExpression(options)) continue;
    const property = options.getProperty('identityRegistry');
    if (tsMorph.Node.isPropertyAssignment(property) || tsMorph.Node.isShorthandPropertyAssignment(property)) {
      property.getNameNode().replaceWithText('ids');
    }
    const ids = options.getProperty('ids');
    if (tsMorph.Node.isPropertyAssignment(ids) && ids.getInitializer()?.getText() === 'ids') {
      ids.replaceWithText('ids');
    }
  }
}

function needsIdAlias(sourceFile, imports, tsMorph) {
  for (const call of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (!tsMorph.Node.isIdentifier(expression) || !isInsideIdBinding(call, tsMorph)) continue;
    if ([...DIRECT_HELPERS.keys()].some((helper) => expression.getText() === imports.get(helper)?.local)) return true;
    if (expression.getText() === imports.get('id')?.local) return true;
    if (
      ID_FACTORY_CONSUMERS.has(expression.getText()) &&
      call.getArguments().some((argument) => argument.getText() === (imports.get('id')?.local ?? 'id'))
    ) {
      return true;
    }
  }
  const registryLocal = imports.get('RenderWireIdentityRegistry')?.local;
  if (
    registryLocal !== undefined &&
    sourceFile
      .getDescendantsOfKind(tsMorph.SyntaxKind.NewExpression)
      .some(
        (expression) =>
          expression.getExpression().getText() === registryLocal && isInsideIdBinding(expression, tsMorph),
      )
  ) {
    return true;
  }
  return sourceFile
    .getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)
    .some(
      (access) =>
        access.getExpression().getText() === (imports.get('id')?.local ?? 'id') &&
        ID_METHODS.has(access.getName()) &&
        isInsideIdBinding(access, tsMorph),
    );
}

function isInsideIdBinding(node, tsMorph) {
  for (const ancestor of node.getAncestors()) {
    if (
      tsMorph.Node.isFunctionLikeDeclaration(ancestor) &&
      ancestor.getParameters().some((parameter) => parameter.getName() === 'id')
    ) {
      return true;
    }
    if (
      (tsMorph.Node.isForOfStatement(ancestor) || tsMorph.Node.isForInStatement(ancestor)) &&
      /\bid\b/.test(ancestor.getInitializer().getText())
    ) {
      return true;
    }
  }
  return false;
}

function renameKnownRenderIdAccesses(sourceFile, tsMorph) {
  for (const access of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
    const method = REGISTRY_METHODS.get(access.getName());
    if (method === undefined) continue;
    const receiver = access.getExpression().getText();
    if (!/(?:^|\.)(?:ids|identities|identityRegistry|#wireIdentities)$/.test(receiver)) continue;
    access.getNameNode().replaceWithText(method);
  }
}

function collectRegistryBindings(sourceFile, registryLocal, tsMorph) {
  const symbols = new Set();
  const names = new Set();
  if (registryLocal === undefined) return { names, symbols };
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (
      tsMorph.Node.isNewExpression(initializer) &&
      initializer.getExpression().getText() === registryLocal &&
      tsMorph.Node.isIdentifier(declaration.getNameNode())
    ) {
      names.add(declaration.getName());
      symbols.add(declaration.getNameNode().getSymbol()?.compilerSymbol);
    }
  }
  for (const parameter of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.Parameter)) {
    if (parameter.getTypeNode()?.getText() !== registryLocal || !tsMorph.Node.isIdentifier(parameter.getNameNode()))
      continue;
    names.add(parameter.getName());
    symbols.add(parameter.getNameNode().getSymbol()?.compilerSymbol);
  }
  symbols.delete(undefined);
  return { names, symbols };
}

function isRegistryReceiver(receiver, bindings) {
  const symbol = receiver.getSymbol()?.compilerSymbol;
  const text = receiver.getText();
  return (
    (symbol !== undefined && bindings.symbols.has(symbol)) ||
    bindings.names.has(text) ||
    /(?:^|\.)(?:identities|identityRegistry|#wireIdentities)$/.test(text)
  );
}

function ensureIdImport(declarations, local, sourceFile) {
  const live = declarations.filter((declaration) => !declaration.wasForgotten());
  const core = live
    .filter((declaration) => idModuleRank(declaration) !== undefined)
    .sort((left, right) => idModuleRank(left) - idModuleRank(right));
  let target = core.find((declaration) => !declaration.isTypeOnly());
  if (target === undefined) {
    target = sourceFile.addImportDeclaration({
      moduleSpecifier: core[0]?.getModuleSpecifierValue() ?? '@pmndrs/glyph/core',
      namedImports: [],
    });
  }
  for (const declaration of live) {
    for (const specifier of declaration.getNamedImports()) {
      if (specifier.getName() === 'id') specifier.remove();
    }
    if (
      declaration !== target &&
      declaration.getNamedImports().length === 0 &&
      declaration.getDefaultImport() === undefined &&
      declaration.getNamespaceImport() === undefined
    ) {
      declaration.remove();
    }
  }
  target.addNamedImport(local === 'id' ? 'id' : { name: 'id', alias: local });
}

function removeImportSpecifier(specifier) {
  const declaration = specifier.getImportDeclaration();
  specifier.remove();
  if (
    declaration.getNamedImports().length === 0 &&
    declaration.getDefaultImport() === undefined &&
    declaration.getNamespaceImport() === undefined
  ) {
    declaration.remove();
  }
}

function idModuleRank(declaration) {
  const specifier = declaration.getModuleSpecifierValue();
  if (/(?:^|\/)core\/render-policy\.js$/.test(specifier)) return 0;
  if (
    specifier === './render-policy.js' &&
    normalize(declaration.getSourceFile().getFilePath()).includes('/packages/glyph/src/core/')
  ) {
    return 0;
  }
  if (specifier === '@pmndrs/glyph/core' || /(?:^|\/)core\.js$/.test(specifier)) return 1;
  return undefined;
}

function renameRegistryImport(specifier, glyphSource, javascript) {
  if (javascript && !glyphSource) {
    removeImportSpecifier(specifier);
    return;
  }
  const replacement = glyphSource ? 'RenderIdScope' : 'RenderIdFactory';
  if (specifier.getAliasNode() !== undefined) {
    specifier.setName(replacement);
    specifier.setIsTypeOnly(!glyphSource);
    return;
  }
  specifier.setAlias(specifier.getName());
  specifier.setName(replacement);
  specifier.removeAliasWithRename();
  specifier.setIsTypeOnly(!glyphSource);
}

function isGlyphModule(sourceFile, specifier) {
  return (
    specifier === '@pmndrs/glyph' ||
    specifier.startsWith('@pmndrs/glyph/') ||
    (normalize(sourceFile.getFilePath()).includes('/packages/glyph/') && /^\.{1,2}\//.test(specifier))
  );
}

function normalize(value) {
  return value.split(path.sep).join('/');
}
