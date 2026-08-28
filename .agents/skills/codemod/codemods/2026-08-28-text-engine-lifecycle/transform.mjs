import path from 'node:path';

export const metadata = Object.freeze({ id: '2026-08-28-text-engine-lifecycle' });

const DECLARATION_RENAMES = new Map([
  ['createTextRuntime', 'createGlyphEngine'],
  ['createTextEngine', 'createGlyphEngine'],
  ['TextRuntime', 'GlyphEngine'],
  ['TextEngine', 'GlyphEngine'],
  ['TextRuntimeOptions', 'GlyphEngineOptions'],
  ['TextEngineOptions', 'GlyphEngineOptions'],
  ['TextRuntimeImpl', 'GlyphEngineImpl'],
  ['TextEngineImpl', 'GlyphEngineImpl'],
  ['TextEngineHost', 'GlyphBackend'],
  ['TextEngineHostOptions', 'GlyphBackendOptions'],
  ['BackendOptions', 'GlyphBackendOptions'],
  ['HostFontBinding', 'BackendFontBinding'],
  ['HostFontStackBinding', 'BackendFontStackBinding'],
  ['HostMaterialBinding', 'BackendMaterialBinding'],
  ['HostPolicy', 'BackendPolicy'],
  ['HostPolicyFactory', 'BackendPolicyFactory'],
  ['HostResourceBinding', 'BackendResourceBinding'],
  ['HostTransformBinding', 'BackendTransformBinding'],
  ['HostOpaqueBindingLease', 'BackendOpaqueBindingLease'],
  ['HostEngineFontBinding', 'BackendEngineFontBinding'],
  ['HostEngineFontBinder', 'BackendEngineFontBinder'],
  ['InstalledHostPolicy', 'InstalledBackendPolicy'],
  ['RetainedHostFontBinding', 'RetainedBackendFontBinding'],
  ['RetainedHostFontStackBinding', 'RetainedBackendFontStackBinding'],
  ['RetainedHostPortablePayload', 'RetainedBackendPortablePayload'],
  ['RetainedHostOpaqueBinding', 'RetainedBackendOpaqueBinding'],
  ['TextEngineSession', 'PlanTransport'],
  ['TextEngineSessionHandle', 'RetainedPlanHandle'],
  ['RawTextEngineSessionOptions', 'PlanTransportOptions'],
  ['TextEnginePublication', 'PlanPublication'],
  ['OwnedTextEnginePublication', 'OwnedPlanPublication'],
  ['TextEnginePublicationExpiredError', 'PlanPublicationExpiredError'],
  ['assertOwnedTextEnginePublication', 'assertOwnedPlanPublication'],
  ['markOwnedTextEnginePublication', 'markOwnedPlanPublication'],
  ['RuntimeFontRegistration', 'EngineFontRegistration'],
  ['RuntimeFontVariantRegistration', 'EngineFontVariantRegistration'],
  ['RuntimeFontBindingLease', 'EngineFontBindingLease'],
  ['RuntimeFontBindingResources', 'EngineFontBindingResources'],
  ['RuntimeFontRegistryLike', 'EngineFontRegistryLike'],
  ['RuntimeFontRegistry', 'EngineFontRegistry'],
  ['RuntimeFontBindingLeaseImpl', 'EngineFontBindingLeaseImpl'],
  ['textRuntimeShaperForTests', 'glyphEngineShaperForTests'],
  ['textEngineShaperForTests', 'glyphEngineShaperForTests'],
  ['observeTextRuntimeDispose', 'observeGlyphEngineDispose'],
  ['observeTextEngineDispose', 'observeGlyphEngineDispose'],
  ['acquireRuntimeFontBinding', 'acquireEngineFontBinding'],
  ['runtimeFontBindingHandle', 'engineFontBindingHandle'],
  ['runtimeFontBindingResources', 'engineFontBindingResources'],
  ['HostRuntimeFontBinding', 'HostEngineFontBinding'],
  ['HostRuntimeFontBinder', 'HostEngineFontBinder'],
  ['SynchronousTextEngineSession', 'SynchronousRetainedPlan'],
  ['AsyncTextEngineSession', 'AsyncRetainedPlan'],
  ['SessionFor', 'RetainedPlanFor'],
  ['TextEnginePublishOptions', 'RetainedPlanPublishOptions'],
  ['TextEngineSessionDisposedError', 'RetainedPlanDisposedError'],
  ['TextEngineText', 'RetainedText'],
  ['TextEngineTextOptions', 'RetainedTextOptions'],
  ['TextEngineTextUpdate', 'RetainedTextUpdate'],
  ['TextEngineTextImpl', 'RetainedTextImpl'],
  ['RetainedSessionBase', 'RetainedPlanBase'],
  ['MeasurementTextEngineSession', 'MeasurementPlan'],
  ['MeasurementTextEngineSessionOptions', 'MeasurementPlanOptions'],
  ['createRetainedTextEngineSession', 'createRetainedPlanImpl'],
  ['createMeasurementTextEngineSession', 'createMeasurementPlan'],
  ['RetainedTextEngineSession', 'RetainedPlanImpl'],
  ['HostPolicyImpl', 'BackendPolicyImpl'],
  ['HostFontBindingImpl', 'BackendFontBindingImpl'],
  ['HostFontStackBindingImpl', 'BackendFontStackBindingImpl'],
  ['HostOpaqueBindingImpl', 'BackendOpaqueBindingImpl'],
  ['nextHostOrdinal', 'nextBackendOrdinal'],
  ['assertSessionOptions', 'assertRetainedPlanOptions'],
  ['assertSessionCapacities', 'assertRetainedPlanCapacities'],
  ['assertMeasurementSessionOptions', 'assertMeasurementPlanOptions'],
  ['SESSION_REQUEST_BYTES', 'PLAN_REQUEST_BYTES'],
  ['SESSION_RESULT_BYTES', 'PLAN_RESULT_BYTES'],
  ['SESSION_TEXT_UNITS', 'PLAN_TEXT_UNITS'],
  ['MIN_SESSION_TEXT_UNITS', 'MIN_PLAN_TEXT_UNITS'],
  ['InstrumentedRawSession', 'InstrumentedPlanTransport'],
  ['createRawSession', 'createPlanTransport'],
  ['PublicTextEngineSessionHandle', 'PublicRetainedPlanHandle'],
  ['combinedSession', 'combinedAuthoringScope'],
  ['combinedScope', 'combinedAuthoringScope'],
  ['sessionOwnedText', 'retainedPlanOwnedText'],
  ['flowHost', 'flowBackend'],
  ['instrumentedHost', 'instrumentedBackend'],
  ['assertSession', 'assertAuthoringScope'],
  ['assertScope', 'assertAuthoringScope'],
  ['ReadyThreeRuntimeDomain', 'ReadyThreeEngineDomain'],
  ['ThreeRuntimeDomain', 'ThreeEngineDomain'],
  ['ThreeRuntimeDomainLease', 'ThreeEngineDomainLease'],
  ['threeRuntimeDomainReport', 'threeEngineDomainReport'],
]);

const IMPORT_RENAMES = new Map([...DECLARATION_RENAMES, ['TextEngineSessionOptions', 'RetainedPlanOptions']]);
const MEMBER_RENAMES = new Map([
  ['#retainedSessions', '#retainedPlans'],
  ['#nextRetainedSessionOrdinal', '#nextRetainedPlanOrdinal'],
  ['_detachRetainedSession', '_detachRetainedPlan'],
  ['_allocateRetainedSessionHandle', '_allocateRetainedPlanHandle'],
  ['#runtimeRegistry', '#fontRegistry'],
  ['#runtime', '#glyphEngine'],
  ['#textEngine', '#glyphEngine'],
  ['#bindRuntimeFont', '#bindEngineFont'],
  ['#assertRuntimeAvailable', '#assertEngineAvailable'],
  ['#enterRuntimeBorrow', '#enterEngineBorrow'],
  ['_assertRuntimeMutationAllowed', '_assertEngineMutationAllowed'],
  ['#sessions', '#transports'],
  ['_createRawSession', '_createPlanTransport'],
  ['#raw', '#transport'],
  ['#hosts', '#backends'],
  ['#nextHostOrdinal', '#nextBackendOrdinal'],
  ['#assertHostAvailable', '#assertBackendAvailable'],
]);

export function transform({ project, renameSymbol, tsMorph }) {
  renameOwnedDeclarations(project, renameSymbol, tsMorph);
  renameIntermediateBackendDeclaration(project, renameSymbol);
  renameImports(project);
  renameHostMethods(project, renameSymbol, tsMorph);
  renameInternalMembers(project, renameSymbol, tsMorph);
  renameOwnershipProperties(project, renameSymbol);
  renameLifecycleLocals(project, renameSymbol, tsMorph);
  renameRetainedPlanInternals(project, renameSymbol, tsMorph);
  renameTransportLocals(project, renameSymbol, tsMorph);
  renameRetainedPlanAbi(project, renameSymbol, tsMorph);
  renamePolicyAuthoringScope(project, renameSymbol, tsMorph);
  renameThreeEngineDomain(project, renameSymbol, tsMorph);
  renameBackendLocals(project, renameSymbol, tsMorph);
  renameBackendInternals(project, renameSymbol, tsMorph);
  renameInternalLocals(project, renameSymbol, tsMorph);
  const movedFiles = moveLifecycleFiles(project);
  repairMovedModuleSpecifiers(project, movedFiles);
}

function renameThreeEngineDomain(project, renameSymbol, tsMorph) {
  const sourceFile = project.getSourceFile((file) =>
    /\/packages\/glyph\/src\/three\/(?:runtime|engine)-domain\.ts$/.test(normalize(file.getFilePath())),
  );
  if (sourceFile === undefined) return;
  const ready = sourceFile.getInterface('ReadyThreeEngineDomain') ?? sourceFile.getInterface('ReadyThreeRuntimeDomain');
  const property = ready?.getProperty('runtime');
  if (property !== undefined) renameSymbol(property, 'glyphEngine', { comments: false });
  for (const parameter of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.Parameter)) {
    if (parameter.getName() === 'runtime') renameSymbol(parameter, 'glyphEngine', { comments: false });
  }
  for (const literal of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.StringLiteral)) {
    const current = literal.getLiteralText();
    const normalized = current
      .replaceAll('runtime domain', 'engine domain')
      .replace('different renderer engine domains', 'different Three engine domains');
    if (normalized !== current) literal.setLiteralValue(normalized);
  }
}

function renamePolicyAuthoringScope(project, renameSymbol, tsMorph) {
  const sourceFile = project.getSourceFile((file) =>
    normalize(file.getFilePath()).endsWith('/packages/glyph/src/core/policy-program.ts'),
  );
  if (sourceFile === undefined) return;
  const nodeType = sourceFile.getTypeAlias('Node');
  for (const declaration of nodeType?.getDescendantsOfKind(tsMorph.SyntaxKind.PropertySignature) ?? []) {
    if (declaration.getName() === 'session' || declaration.getName() === 'scope') {
      renameSymbol(declaration, 'authoringScope', { comments: false });
    }
  }
  for (const [before, after] of [
    ['combinedSession', 'combinedAuthoringScope'],
    ['combinedScope', 'combinedAuthoringScope'],
    ['assertSession', 'assertAuthoringScope'],
    ['assertScope', 'assertAuthoringScope'],
  ]) {
    const declaration = sourceFile.getFunction(before);
    if (declaration !== undefined) renameSymbol(declaration, after, { comments: false });
  }
  const assertAuthoringScope = sourceFile.getFunction('assertAuthoringScope');
  for (const parameter of assertAuthoringScope?.getParameters() ?? []) {
    if (parameter.getName() === 'session' || parameter.getName() === 'scope') {
      renameSymbol(parameter, 'authoringScope', { comments: false });
    }
  }
  for (const declaration of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)) {
    if (
      (declaration.getName() === 'session' || declaration.getName() === 'scope') &&
      declaration.getInitializer()?.getText() === '{}'
    ) {
      renameSymbol(declaration, 'authoringScope', { comments: false });
    }
  }
}

function renameRetainedPlanAbi(project, renameSymbol, tsMorph) {
  const memberRenames = new Map([
    ['createSession', 'createRetainedPlan'],
    ['reserveSession', 'reserveRetainedPlan'],
    ['disposeSession', 'disposeRetainedPlan'],
    ['sessionCount', 'retainedPlanCount'],
    ['sessionId', 'retainedPlanId'],
    ['sessionHandle', 'retainedPlanHandle'],
    ['sessions', 'retainedPlans'],
    ['defaultSessionTextCapacity', 'defaultRetainedPlanTextCapacity'],
  ]);
  const syntaxRenames = new Map([
    ['sessionConflict', 'retainedPlanConflict'],
    ['sessionMissing', 'retainedPlanMissing'],
    ['sessionId', 'retainedPlanId'],
    ['defaultSessionTextCapacity', 'defaultRetainedPlanTextCapacity'],
  ]);
  for (const sourceFile of project.getSourceFiles()) {
    if (!isGlyphRepositoryFile(sourceFile) || normalize(sourceFile.getFilePath()).includes('/dist/')) continue;
    for (;;) {
      const declaration = sourceFile.getDescendants().find((candidate) => {
        if (
          !tsMorph.Node.isPropertySignature(candidate) &&
          !tsMorph.Node.isPropertyDeclaration(candidate) &&
          !tsMorph.Node.isMethodSignature(candidate) &&
          !tsMorph.Node.isMethodDeclaration(candidate) &&
          !tsMorph.Node.isVariableDeclaration(candidate) &&
          !tsMorph.Node.isParameterDeclaration(candidate)
        ) {
          return false;
        }
        const name = candidate.getName();
        if (!memberRenames.has(name)) return false;
        if (
          name === 'createSession' ||
          name === 'reserveSession' ||
          name === 'disposeSession' ||
          name === 'sessionCount'
        ) {
          return (
            candidate.getFirstAncestorByKind(tsMorph.SyntaxKind.InterfaceDeclaration)?.getName() === 'ShaperExports'
          );
        }
        if (name === 'sessions') {
          return (
            candidate.getFirstAncestorByKind(tsMorph.SyntaxKind.InterfaceDeclaration)?.getName() ===
            'EngineRegistrationOwners'
          );
        }
        return true;
      });
      if (declaration === undefined) break;
      renameSymbol(declaration, memberRenames.get(declaration.getName()), { comments: false });
    }
    for (const access of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
      const replacement = syntaxRenames.get(access.getName());
      if (replacement !== undefined) {
        access.getNameNode().replaceWithText(replacement);
        continue;
      }
      if (access.getExpression().getText() === 'functions') {
        const abiFunction = memberRenames.get(access.getName());
        if (abiFunction !== undefined) access.getNameNode().replaceWithText(abiFunction);
      }
    }
    for (const literal of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.StringLiteral)) {
      if (literal.getLiteralText() === 'session') literal.setLiteralValue('retained-plan');
      else if (literal.getLiteralText() === 'sessionId') literal.setLiteralValue('retainedPlanId');
      else if (literal.getLiteralText() === 'session-conflict') literal.setLiteralValue('retained-plan-conflict');
      else if (literal.getLiteralText() === 'session-missing') literal.setLiteralValue('retained-plan-missing');
      else if (literal.getLiteralText() === 'session-owned' || literal.getLiteralText() === 'retained-plan-owned') {
        literal.setLiteralValue('plan-owned');
      } else if (literal.getLiteralText() === 'type-test/session') literal.setLiteralValue('type-test/retained-plan');
      else if (literal.getLiteralText() === 'claims one target for exactly one session and cascades disposal') {
        literal.setLiteralValue('claims one target for exactly one retained plan and cascades disposal');
      } else if (literal.getLiteralText().includes(' text runtime(s) ')) {
        literal.setLiteralValue(literal.getLiteralText().replace(' text runtime(s) ', ' glyph engine(s) '));
      }
    }
    for (const kind of [
      tsMorph.SyntaxKind.TemplateHead,
      tsMorph.SyntaxKind.TemplateMiddle,
      tsMorph.SyntaxKind.TemplateTail,
    ]) {
      for (const fragment of sourceFile.getDescendantsOfKind(kind)) {
        if (fragment.getText().includes(' text runtime(s) ')) {
          fragment.replaceWithText(fragment.getText().replace(' text runtime(s) ', ' glyph engine(s) '));
        }
      }
    }
  }
}

function renameRetainedPlanInternals(project, renameSymbol, tsMorph) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    for (;;) {
      const declaration = sourceFile.getDescendants().find((candidate) => {
        if (
          !tsMorph.Node.isVariableDeclaration(candidate) &&
          !tsMorph.Node.isParameterDeclaration(candidate) &&
          !tsMorph.Node.isPropertyDeclaration(candidate) &&
          !tsMorph.Node.isPropertySignature(candidate)
        ) {
          return false;
        }
        if (candidate.getName() !== 'session' && candidate.getName() !== '#session') return false;
        return /\b(?:RetainedPlanImpl|MeasurementPlan|SynchronousRetainedPlan|AsyncRetainedPlan|RetainedPlanHandle)\b/.test(
          candidate.getTypeNode()?.getText() ?? candidate.getType().getText(),
        );
      });
      if (declaration === undefined) break;
      renameSymbol(declaration, declaration.getName() === '#session' ? '#retainedPlan' : 'retainedPlan', {
        comments: false,
      });
    }
  }
}

function renameTransportLocals(project, renameSymbol, tsMorph) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    for (;;) {
      const declaration = sourceFile.getDescendants().find((candidate) => {
        if (
          !tsMorph.Node.isVariableDeclaration(candidate) &&
          !tsMorph.Node.isParameterDeclaration(candidate) &&
          !tsMorph.Node.isPropertyDeclaration(candidate)
        ) {
          return false;
        }
        if (candidate.getName() !== 'session' && candidate.getName() !== '#session') return false;
        const type = candidate.getTypeNode()?.getText() ?? candidate.getType().getText();
        const initializer = tsMorph.Node.isVariableDeclaration(candidate)
          ? (candidate.getInitializer()?.getText() ?? '')
          : '';
        const loop =
          candidate.getFirstAncestorByKind(tsMorph.SyntaxKind.ForOfStatement)?.getExpression().getText() ?? '';
        return (
          /\bPlanTransport\b/.test(type) ||
          /^(?:new PlanTransport|createPlanTransport)\(/.test(initializer) ||
          loop.includes('#transports')
        );
      });
      if (declaration === undefined) break;
      renameSymbol(declaration, declaration.getName() === '#session' ? '#transport' : 'transport', { comments: false });
    }
  }
}

function renameIntermediateBackendDeclaration(project, renameSymbol) {
  const sourceFile = project.getSourceFile((file) =>
    /\/packages\/glyph\/src\/core\/(?:host|backend)\.ts$/.test(normalize(file.getFilePath())),
  );
  const declaration = sourceFile?.getClass('Backend');
  if (declaration !== undefined) renameSymbol(declaration, 'GlyphBackend');
}

function renameBackendLocals(project, renameSymbol, tsMorph) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    for (;;) {
      const declaration = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration).find((candidate) => {
        if (candidate.getName() !== 'host') return false;
        const type = candidate.getTypeNode()?.getText() ?? candidate.getType().getText();
        const initializer = candidate.getInitializer()?.getText() ?? '';
        return /\b(?:Glyph)?Backend\b/.test(type) || initializer.includes('.createBackend(');
      });
      if (declaration === undefined) break;
      renameSymbol(declaration, 'backend', { comments: false });
    }
    for (;;) {
      const parameter = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.Parameter).find((candidate) => {
        if (candidate.getName() !== 'host') return false;
        return /\b(?:Glyph)?Backend\b/.test(candidate.getTypeNode()?.getText() ?? '');
      });
      if (parameter === undefined) break;
      renameSymbol(parameter, 'backend', { comments: false });
    }
    for (;;) {
      const declaration = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration).find((candidate) => {
        if (candidate.getName() !== 'host') return false;
        const loop = candidate.getFirstAncestorByKind(tsMorph.SyntaxKind.ForOfStatement);
        return loop?.getExpression().getText().includes('#backends') ?? false;
      });
      if (declaration === undefined) break;
      renameSymbol(declaration, 'backend', { comments: false });
    }
  }
}

function renameBackendInternals(project, renameSymbol, tsMorph) {
  const variableRenames = new Map([
    ['hostPolicies', 'backendPolicies'],
    ['hostFontStacks', 'backendFontStacks'],
    ['hostOpaqueBindings', 'backendOpaqueBindings'],
    ['hostPolicyBrand', 'backendPolicyBrand'],
    ['hostFontBindingBrand', 'backendFontBindingBrand'],
    ['hostFontStackBindingBrand', 'backendFontStackBindingBrand'],
    ['hostMaterialBindingBrand', 'backendMaterialBindingBrand'],
    ['hostResourceBindingBrand', 'backendResourceBindingBrand'],
    ['hostTransformBindingBrand', 'backendTransformBindingBrand'],
  ]);
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile() || !isGlyphRepositoryFile(sourceFile)) continue;
    for (;;) {
      const declaration = sourceFile
        .getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)
        .find((candidate) => variableRenames.has(candidate.getName()));
      if (declaration === undefined) break;
      renameSymbol(declaration, variableRenames.get(declaration.getName()), { comments: false });
    }
    for (;;) {
      const property = sourceFile.getDescendants().find((candidate) => {
        if (!tsMorph.Node.isPropertyDeclaration(candidate) && !tsMorph.Node.isPropertySignature(candidate))
          return false;
        if (candidate.getName() !== 'host' && candidate.getName() !== '#host') return false;
        return /\bGlyphBackend\b/.test(candidate.getTypeNode()?.getText() ?? candidate.getType().getText());
      });
      if (property === undefined) break;
      renameSymbol(property, property.getName() === '#host' ? '#backend' : 'backend', { comments: false });
    }
  }
}

function renameOwnershipProperties(project, renameSymbol) {
  const host = project.getSourceFile((file) =>
    /\/packages\/glyph\/src\/core\/(?:host|backend)\.ts$/.test(normalize(file.getFilePath())),
  );
  const engineBinding =
    host?.getInterface('RetainedBackendFontBinding')?.getProperty('runtime') ??
    host?.getInterface('RetainedHostFontBinding')?.getProperty('runtime');
  if (engineBinding !== undefined) renameSymbol(engineBinding, 'engineBinding', { comments: false });

  const paragraph = project.getSourceFile((file) =>
    normalize(file.getFilePath()).endsWith('/packages/glyph/src/paragraph.ts'),
  );
  for (const name of ['MeasurementServiceLease', 'MeasurementService']) {
    const owner = paragraph?.getInterface(name);
    const property = owner?.getProperty('runtime') ?? owner?.getProperty('textEngine');
    if (property !== undefined) renameSymbol(property, 'glyphEngine', { comments: false });
  }
}

function renameInternalLocals(project, renameSymbol, tsMorph) {
  const parameterRenames = new Map([
    ['runtimeRegistry', 'fontRegistry'],
    ['bindRuntimeFont', 'bindEngineFont'],
    ['assertRuntimeAvailable', 'assertEngineAvailable'],
    ['enterRuntimeBorrow', 'enterEngineBorrow'],
    ['hostIdentities', 'backendIdentities'],
  ]);
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile() || !isGlyphRepositoryFile(sourceFile)) continue;
    for (;;) {
      const parameter = sourceFile
        .getDescendantsOfKind(tsMorph.SyntaxKind.Parameter)
        .find((candidate) => parameterRenames.has(candidate.getName()));
      if (parameter === undefined) break;
      renameSymbol(parameter, parameterRenames.get(parameter.getName()), { comments: false });
    }
    for (;;) {
      const declaration = sourceFile
        .getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)
        .find((candidate) => candidate.getName() === 'runtimeCount');
      if (declaration === undefined) break;
      renameSymbol(declaration, 'engineCount', { comments: false });
    }
    for (;;) {
      const declaration = sourceFile
        .getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)
        .find(
          (candidate) =>
            candidate.getName() === 'runtimeRegistry' ||
            (candidate.getName() === 'runtime' && candidate.getInitializer()?.getText().includes('#bindEngineFont')),
        );
      if (declaration === undefined) break;
      renameSymbol(declaration, declaration.getName() === 'runtimeRegistry' ? 'fontRegistry' : 'engineBinding', {
        comments: false,
      });
    }
    for (;;) {
      const loop = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.ForOfStatement).find((candidate) => {
        const initializer = candidate.getInitializer();
        const declaration = tsMorph.Node.isVariableDeclarationList(initializer)
          ? initializer.getDeclarations()[0]
          : undefined;
        return declaration?.getName() === 'session' && candidate.getExpression().getText().includes('#retainedPlans');
      });
      if (loop === undefined) break;
      const initializer = loop.getInitializer();
      if (!tsMorph.Node.isVariableDeclarationList(initializer)) throw new TypeError('expected a retained-plan loop');
      const declaration = initializer.getDeclarations()[0];
      renameSymbol(declaration, 'retainedPlan', { comments: false });
    }
    for (;;) {
      const parameter = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.Parameter).find((candidate) => {
        const method = candidate.getFirstAncestorByKind(tsMorph.SyntaxKind.MethodDeclaration);
        return candidate.getName() === 'session' && method?.getName() === '_detachRetainedPlan';
      });
      if (parameter === undefined) break;
      renameSymbol(parameter, 'retainedPlan', { comments: false });
    }
  }
}

function renameInternalMembers(project, renameSymbol, tsMorph) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile() || !isGlyphRepositoryFile(sourceFile)) continue;
    for (;;) {
      const declaration = sourceFile.getDescendants().find((candidate) => {
        if (
          !tsMorph.Node.isPropertyDeclaration(candidate) &&
          !tsMorph.Node.isPropertySignature(candidate) &&
          !tsMorph.Node.isMethodDeclaration(candidate)
        ) {
          return false;
        }
        return MEMBER_RENAMES.has(candidate.getName());
      });
      if (declaration === undefined) break;
      renameSymbol(declaration, MEMBER_RENAMES.get(declaration.getName()));
    }
  }
}

function renameOwnedDeclarations(project, renameSymbol, tsMorph) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile() || !isGlyphRepositoryFile(sourceFile)) continue;
    const relative = normalize(sourceFile.getFilePath());
    for (;;) {
      const declaration = sourceFile.getDescendants().find((candidate) => {
        if (!isNamedDeclaration(candidate, tsMorph)) return false;
        const name = candidate.getName();
        return (
          DECLARATION_RENAMES.has(name) ||
          (name === 'TextEngineSessionOptions' && relative.endsWith('/packages/glyph/src/core/retained-session.ts'))
        );
      });
      if (declaration === undefined) break;
      const original = declaration.getName();
      const replacement =
        original === 'TextEngineSessionOptions' ? 'RetainedPlanOptions' : DECLARATION_RENAMES.get(original);
      renameSymbol(declaration, replacement);
    }
  }
}

function renameImports(project) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    for (const imported of sourceFile
      .getImportDeclarations()
      .filter((declaration) => isGlyphModuleDeclaration(sourceFile, declaration))
      .flatMap((declaration) => declaration.getNamedImports())) {
      const alias = imported.getAliasNode();
      const replacement = alias === undefined ? undefined : DECLARATION_RENAMES.get(alias.getText());
      if (replacement !== undefined) alias.replaceWithText(replacement);
    }
    for (;;) {
      const imported = sourceFile
        .getImportDeclarations()
        .filter((declaration) => isGlyphModuleDeclaration(sourceFile, declaration))
        .flatMap((declaration) => declaration.getNamedImports())
        .find((entry) => IMPORT_RENAMES.has(entry.getName()));
      if (imported === undefined) break;
      const replacement = IMPORT_RENAMES.get(imported.getName());
      if (imported.getAliasNode() !== undefined) {
        imported.setName(replacement);
        continue;
      }
      imported.setAlias(imported.getName());
      imported.setName(replacement);
      imported.removeAliasWithRename();
    }
    for (;;) {
      const exported = sourceFile
        .getExportDeclarations()
        .filter((declaration) => isGlyphModuleDeclaration(sourceFile, declaration))
        .flatMap((declaration) => declaration.getNamedExports())
        .find((entry) => IMPORT_RENAMES.has(entry.getName()));
      if (exported === undefined) break;
      const replacement = IMPORT_RENAMES.get(exported.getName());
      if (exported.getAliasNode() !== undefined) {
        exported.setName(replacement);
        continue;
      }
      exported.setAlias(exported.getName());
      exported.setName(replacement);
      exported.removeAliasWithRename();
    }
  }
}

function renameHostMethods(project, renameSymbol, tsMorph) {
  const runtime = project.getSourceFile((file) =>
    /\/packages\/glyph\/src\/(?:text-(?:runtime|engine)|glyph-engine)\.ts$/.test(normalize(file.getFilePath())),
  );
  const runtimeInterface =
    runtime?.getInterface('GlyphEngine') ?? runtime?.getInterface('TextEngine') ?? runtime?.getInterface('TextRuntime');
  const runtimeClass =
    runtime?.getClass('GlyphEngineImpl') ?? runtime?.getClass('TextEngineImpl') ?? runtime?.getClass('TextRuntimeImpl');
  for (const owner of [runtimeInterface, runtimeClass]) {
    const method = owner?.getMethod('createTextEngineHost') ?? owner?.getMethod('createHost');
    if (method !== undefined) renameSymbol(method, 'createBackend');
  }

  const host = project.getSourceFile((file) =>
    /\/packages\/glyph\/src\/core\/(?:host|backend)\.ts$/.test(normalize(file.getFilePath())),
  );
  const hostClass = host?.getClass('GlyphBackend') ?? host?.getClass('Backend') ?? host?.getClass('TextEngineHost');
  const retainedMethod = hostClass
    ?.getMethods()
    .find((entry) => entry.getName() === 'createSession' && entry.getText().includes('TextPlanTarget'));
  if (retainedMethod !== undefined) renameSymbol(retainedMethod, 'createRetainedPlan');

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    for (;;) {
      const access = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression).find((entry) => {
        if (entry.getName() === 'createTextEngineHost' || entry.getName() === 'createHost') {
          return isGlyphEngineMethod(entry.getNameNode(), tsMorph);
        }
        if (entry.getName() !== 'createSession') return false;
        return isTextEngineHostMethod(entry.getNameNode(), tsMorph);
      });
      if (access === undefined) break;
      if (access.getName() === 'createTextEngineHost' || access.getName() === 'createHost') {
        access.getNameNode().replaceWithText('createBackend');
        continue;
      }
      if (access.getName() !== 'createSession') continue;
      access.getNameNode().replaceWithText('createRetainedPlan');
    }
  }
}

function isGlyphEngineMethod(nameNode, tsMorph) {
  return (nameNode.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
    const owner =
      declaration.getFirstAncestorByKind(tsMorph.SyntaxKind.InterfaceDeclaration) ??
      declaration.getFirstAncestorByKind(tsMorph.SyntaxKind.ClassDeclaration);
    return [
      'TextRuntime',
      'TextEngine',
      'GlyphEngine',
      'TextRuntimeImpl',
      'TextEngineImpl',
      'GlyphEngineImpl',
    ].includes(owner?.getName() ?? '');
  });
}

function isTextEngineHostMethod(nameNode, tsMorph) {
  return (nameNode.getSymbol()?.getDeclarations() ?? []).some((declaration) => {
    const owner = declaration.getFirstAncestorByKind(tsMorph.SyntaxKind.ClassDeclaration);
    return (
      owner?.getName() === 'TextEngineHost' || owner?.getName() === 'Backend' || owner?.getName() === 'GlyphBackend'
    );
  });
}

function renameLifecycleLocals(project, renameSymbol, tsMorph) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    for (;;) {
      const declaration = sourceFile
        .getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)
        .find(
          (candidate) =>
            ((candidate.getName() === 'runtime' ||
              candidate.getName() === 'engine' ||
              candidate.getName() === 'textEngine') &&
              isEngineValue(candidate, tsMorph)) ||
            ((candidate.getName() === 'session' ||
              candidate.getName() === 'plan' ||
              candidate.getName().endsWith('Session')) &&
              isRetainedPlanValue(candidate, tsMorph)),
        );
      if (declaration === undefined) break;
      const name = declaration.getName();
      const replacement =
        name === 'runtime' || name === 'engine' || name === 'textEngine'
          ? 'glyphEngine'
          : name === 'session' || name === 'plan'
            ? 'retainedPlan'
            : `${name.slice(0, -'Session'.length)}RetainedPlan`;
      renameSymbol(declaration, replacement, { comments: false });
    }
    for (;;) {
      const parameter = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.Parameter).find((candidate) => {
        const type = candidate.getTypeNode()?.getText() ?? '';
        return (
          ((candidate.getName() === 'runtime' ||
            candidate.getName() === 'engine' ||
            candidate.getName() === 'textEngine') &&
            /\b(?:TextEngine|GlyphEngine)(?:Impl)?\b/.test(type)) ||
          ((candidate.getName() === 'session' || candidate.getName() === 'plan') &&
            /\b(?:Synchronous|Async)RetainedPlan\b/.test(type))
        );
      });
      if (parameter === undefined) break;
      renameSymbol(
        parameter,
        parameter.getName() === 'runtime' || parameter.getName() === 'engine' || parameter.getName() === 'textEngine'
          ? 'glyphEngine'
          : 'retainedPlan',
        { comments: false },
      );
    }
    for (;;) {
      const property = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyDeclaration).find((candidate) => {
        const name = candidate.getName();
        return (
          (name === '#session' || name === 'session') &&
          /\b(?:Synchronous|Async)RetainedPlan\b/.test(candidate.getTypeNode()?.getText() ?? '')
        );
      });
      if (property === undefined) break;
      renameSymbol(property, property.getName().startsWith('#') ? '#retainedPlan' : 'retainedPlan', {
        comments: false,
      });
    }
    for (;;) {
      const method = sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.MethodDeclaration).find((candidate) => {
        const name = candidate.getName();
        return (
          (name === 'openSession' || name === '#requireSession') &&
          /\b(?:Synchronous|Async)RetainedPlan\b/.test(candidate.getReturnTypeNode()?.getText() ?? '')
        );
      });
      if (method === undefined) break;
      renameSymbol(method, method.getName() === 'openSession' ? 'openRetainedPlan' : '#requireRetainedPlan', {
        comments: false,
      });
    }
  }
}

function isEngineValue(declaration, tsMorph) {
  if (/\b(?:TextEngine|GlyphEngine)\b/.test(declaration.getTypeNode()?.getText() ?? '')) return true;
  const initializer = declaration.getInitializer();
  if (tsMorph.Node.isAwaitExpression(initializer)) {
    return /^(?:createTextEngine|createGlyphEngine)\(/.test(initializer.getExpression().getText());
  }
  return /^(?:createTextEngine|createGlyphEngine)\(/.test(initializer?.getText() ?? '');
}

function isRetainedPlanValue(declaration, tsMorph) {
  if (/\b(?:Synchronous|Async)RetainedPlan\b/.test(declaration.getTypeNode()?.getText() ?? '')) return true;
  const initializer = declaration.getInitializer();
  if (!tsMorph.Node.isCallExpression(initializer)) return false;
  return /\.(?:createRetainedPlan|openRetainedPlan|#?requireRetainedPlan)$/.test(initializer.getExpression().getText());
}

function moveLifecycleFiles(project) {
  const movedFiles = new Set();
  moveIfPresent(project, movedFiles, '/packages/glyph/src/text-runtime.ts', '/packages/glyph/src/glyph-engine.ts');
  moveIfPresent(project, movedFiles, '/packages/glyph/src/text-engine.ts', '/packages/glyph/src/glyph-engine.ts');
  moveIfPresent(
    project,
    movedFiles,
    '/packages/glyph/src/core/retained-session.ts',
    '/packages/glyph/src/core/retained-plan.ts',
  );
  moveIfPresent(
    project,
    movedFiles,
    '/packages/glyph/tests/types/text-runtime-api.test.ts',
    '/packages/glyph/tests/types/glyph-engine-api.test.ts',
  );
  moveIfPresent(
    project,
    movedFiles,
    '/packages/glyph/tests/types/text-engine-api.test.ts',
    '/packages/glyph/tests/types/glyph-engine-api.test.ts',
  );
  moveIfPresent(
    project,
    movedFiles,
    '/packages/glyph/src/three/runtime-domain.ts',
    '/packages/glyph/src/three/engine-domain.ts',
  );
  moveIfPresent(
    project,
    movedFiles,
    '/packages/glyph/src/three/engine-runtime.ts',
    '/packages/glyph/src/three/engine-coordinator.ts',
  );
  moveIfPresent(project, movedFiles, '/packages/glyph/src/core/host.ts', '/packages/glyph/src/core/backend.ts');
  return movedFiles;
}

function moveIfPresent(project, movedFiles, suffix, replacementSuffix) {
  const sourceFile = project.getSourceFile((file) => normalize(file.getFilePath()).endsWith(suffix));
  if (sourceFile === undefined) return;
  const current = normalize(sourceFile.getFilePath());
  const next = `${current.slice(0, -suffix.length)}${replacementSuffix}`;
  sourceFile.move(path.normalize(next));
  movedFiles.add(normalize(next));
}

function repairMovedModuleSpecifiers(project, movedFiles) {
  if (movedFiles.size === 0) return;
  for (const sourceFile of project.getSourceFiles()) {
    for (const declaration of [...sourceFile.getImportDeclarations(), ...sourceFile.getExportDeclarations()]) {
      const specifier = declaration.getModuleSpecifierValue();
      const target = declaration.getModuleSpecifierSourceFile();
      if (
        target !== undefined &&
        movedFiles.has(normalize(target.getFilePath())) &&
        /^\.{1,2}\//.test(specifier) &&
        path.extname(specifier) === ''
      ) {
        declaration.setModuleSpecifier(`${specifier}.js`);
      }
    }
  }
}

function isNamedDeclaration(node, tsMorph) {
  return (
    tsMorph.Node.isFunctionDeclaration(node) ||
    tsMorph.Node.isInterfaceDeclaration(node) ||
    tsMorph.Node.isTypeAliasDeclaration(node) ||
    tsMorph.Node.isClassDeclaration(node)
  );
}

function normalize(value) {
  return value.split(path.sep).join('/');
}

function isGlyphRepositoryFile(sourceFile) {
  return normalize(sourceFile.getFilePath()).includes('/packages/glyph/');
}

function isGlyphModuleDeclaration(sourceFile, declaration) {
  const specifier = declaration.getModuleSpecifierValue();
  if (specifier === undefined) return false;
  return (
    specifier === '@pmndrs/glyph' ||
    specifier.startsWith('@pmndrs/glyph/') ||
    (isGlyphRepositoryFile(sourceFile) && /^\.{1,2}\//.test(specifier))
  );
}
