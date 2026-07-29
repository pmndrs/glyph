// Three.js r185 - Node System

// global
diagnostic( off, derivative_uniformity );


// structs

struct OutputStruct {
	@location( 0 ) color: vec4<f32>
};
var<private> output : OutputStruct;

// uniforms
@binding( 0 ) @group( 1 ) var nodeUniform4 : texture_2d<u32>;
@binding( 1 ) @group( 1 ) var nodeUniform5 : texture_2d<u32>;
@binding( 2 ) @group( 1 ) var nodeUniform6 : texture_2d<f32>;

// vars
var<private> DiffuseColor : vec4<f32>;
var<private> slugEmsPerPixel : vec2<f32>;
var<private> slugPixelsPerEmX : f32;
var<private> slugPixelsPerEmY : f32;
var<private> slugPixelsPerEm : f32;
var<private> nodeVar9 : vec4<u32>;
var<private> slugHorizontalHeader : u32;
var<private> slugHorizontalReferenceOffset : u32;
var<private> slugXCoverage : f32;
var<private> slugXWeight : f32;
var<private> slugHorizontalCurveIndex : i32;
var<private> nodeVar10 : u32;
var<private> nodeVar11 : vec4<u32>;
var<private> slugHorizontalReference : u32;
var<private> nodeVar12 : u32;
var<private> nodeVar13 : vec4<f32>;
var<private> slugHorizontalP0 : vec2<f32>;
var<private> slugHorizontalP1 : vec2<f32>;
var<private> nodeVar14 : vec4<f32>;
var<private> slugHorizontalP2 : vec2<f32>;
var<private> slugHorizontalRootCode : u32;
var<private> nodeVar15 : f32;
var<private> nodeVar16 : f32;
var<private> slugHorizontalDiscriminant : f32;
var<private> slugHorizontalPolynomialRoot1 : f32;
var<private> slugHorizontalPolynomialRoot2 : f32;
var<private> nodeVar17 : f32;
var<private> nodeVar18 : f32;
var<private> slugHorizontalRootDistance : f32;
var<private> slugHorizontalBPositive : bool;
var<private> nodeVar19 : f32;
var<private> slugHorizontalQ : f32;
var<private> slugHorizontalRootA : f32;
var<private> slugHorizontalRootB : f32;
var<private> nodeVar20 : f32;
var<private> nodeVar21 : f32;
var<private> nodeVar22 : f32;
var<private> nodeVar23 : vec2<f32>;
var<private> nodeVar24 : f32;
var<private> nodeVar25 : vec2<f32>;
var<private> slugHorizontalRoot1 : f32;
var<private> slugHorizontalRoot2 : f32;
var<private> slugHorizontalHasRoot1 : bool;
var<private> slugHorizontalHasRoot2 : bool;
var<private> nodeVar26 : f32;
var<private> nodeVar27 : f32;
var<private> nodeVar28 : f32;
var<private> nodeVar29 : f32;
var<private> nodeVar30 : vec4<u32>;
var<private> slugVerticalHeader : u32;
var<private> slugVerticalReferenceOffset : u32;
var<private> slugYCoverage : f32;
var<private> slugYWeight : f32;
var<private> slugVerticalCurveIndex : i32;
var<private> nodeVar31 : u32;
var<private> nodeVar32 : vec4<u32>;
var<private> slugVerticalReference : u32;
var<private> nodeVar33 : u32;
var<private> nodeVar34 : vec4<f32>;
var<private> slugVerticalP0 : vec2<f32>;
var<private> slugVerticalP1 : vec2<f32>;
var<private> nodeVar35 : vec4<f32>;
var<private> slugVerticalP2 : vec2<f32>;
var<private> slugVerticalRootCode : u32;
var<private> nodeVar36 : f32;
var<private> nodeVar37 : f32;
var<private> slugVerticalDiscriminant : f32;
var<private> slugVerticalPolynomialRoot1 : f32;
var<private> slugVerticalPolynomialRoot2 : f32;
var<private> nodeVar38 : f32;
var<private> nodeVar39 : f32;
var<private> slugVerticalRootDistance : f32;
var<private> slugVerticalBPositive : bool;
var<private> nodeVar40 : f32;
var<private> slugVerticalQ : f32;
var<private> slugVerticalRootA : f32;
var<private> slugVerticalRootB : f32;
var<private> nodeVar41 : f32;
var<private> nodeVar42 : f32;
var<private> nodeVar43 : f32;
var<private> nodeVar44 : vec2<f32>;
var<private> nodeVar45 : f32;
var<private> nodeVar46 : vec2<f32>;
var<private> slugVerticalRoot1 : f32;
var<private> slugVerticalRoot2 : f32;
var<private> slugVerticalHasRoot1 : bool;
var<private> slugVerticalHasRoot2 : bool;
var<private> nodeVar47 : f32;
var<private> nodeVar48 : f32;
var<private> nodeVar49 : f32;
var<private> nodeVar50 : f32;
var<private> slugRawCoverage : f32;
var<private> nodeVar51 : f32;
var<private> slugCoverage : f32;
var<private> nodeVar52 : f32;
var<private> slugOutlinedFillAlpha : f32;
var<private> slugOutlinedOutlineAlpha : f32;
var<private> slugStrokeEmsPerPixel : vec2<f32>;
var<private> slugStrokePixelEm : f32;
var<private> slugStrokeAaHalfWidth : f32;
var<private> slugStrokeEffectiveHalfWidth : f32;
var<private> slugStrokeSearchRadius : f32;
var<private> slugStrokeMinimumDistance : f32;
var<private> nodeVar53 : f32;
var<private> nodeVar54 : vec4<u32>;
var<private> slugStrokeHorizontalHeader : u32;
var<private> nodeVar55 : u32;
var<private> nodeVar56 : vec4<u32>;
var<private> slugStrokeHorizontalReference : u32;
var<private> nodeVar57 : u32;
var<private> nodeVar58 : vec4<f32>;
var<private> nodeVar59 : vec2<f32>;
var<private> nodeVar60 : vec4<f32>;
var<private> nodeVar61 : vec2<f32>;
var<private> nodeVar62 : vec2<f32>;
var<private> slugStrokeHorizontalSecondDifference : vec2<f32>;
var<private> slugStrokeHorizontalInitialTangent : vec2<f32>;
var<private> slugStrokeHorizontalOriginOffset : vec2<f32>;
var<private> slugStrokeHorizontalCubic : f32;
var<private> slugStrokeHorizontalQuadratic : f32;
var<private> slugStrokeHorizontalLinear : f32;
var<private> slugStrokeHorizontalConstant : f32;
var<private> slugStrokeHorizontalNewtonSlope0 : f32;
var<private> nodeVar63 : f32;
var<private> slugStrokeHorizontalClosestT : f32;
var<private> slugStrokeHorizontalNewtonSlope1 : f32;
var<private> nodeVar64 : f32;
var<private> slugStrokeHorizontalNewtonSlope2 : f32;
var<private> nodeVar65 : f32;
var<private> nodeVar66 : f32;
var<private> nodeVar67 : f32;
var<private> nodeVar68 : f32;
var<private> nodeVar69 : f32;
var<private> nodeVar70 : f32;
var<private> nodeVar71 : f32;
var<private> nodeVar72 : f32;
var<private> nodeVar73 : f32;
var<private> nodeVar74 : f32;
var<private> nodeVar75 : f32;
var<private> nodeVar76 : bool;
var<private> nodeVar77 : f32;
var<private> nodeVar78 : f32;
var<private> nodeVar79 : f32;
var<private> nodeVar80 : f32;
var<private> nodeVar81 : bool;
var<private> nodeVar82 : f32;
var<private> nodeVar83 : f32;
var<private> nodeVar84 : f32;
var<private> nodeVar85 : vec4<u32>;
var<private> slugStrokeVerticalHeader : u32;
var<private> nodeVar86 : u32;
var<private> nodeVar87 : vec4<u32>;
var<private> slugStrokeVerticalReference : u32;
var<private> nodeVar88 : u32;
var<private> nodeVar89 : vec4<f32>;
var<private> nodeVar90 : vec2<f32>;
var<private> nodeVar91 : vec2<f32>;
var<private> nodeVar92 : vec4<f32>;
var<private> nodeVar93 : vec2<f32>;
var<private> slugStrokeVerticalSecondDifference : vec2<f32>;
var<private> slugStrokeVerticalInitialTangent : vec2<f32>;
var<private> slugStrokeVerticalOriginOffset : vec2<f32>;
var<private> slugStrokeVerticalCubic : f32;
var<private> slugStrokeVerticalQuadratic : f32;
var<private> slugStrokeVerticalLinear : f32;
var<private> slugStrokeVerticalConstant : f32;
var<private> slugStrokeVerticalNewtonSlope0 : f32;
var<private> nodeVar94 : f32;
var<private> slugStrokeVerticalClosestT : f32;
var<private> slugStrokeVerticalNewtonSlope1 : f32;
var<private> nodeVar95 : f32;
var<private> slugStrokeVerticalNewtonSlope2 : f32;
var<private> nodeVar96 : f32;
var<private> nodeVar97 : f32;
var<private> nodeVar98 : f32;
var<private> nodeVar99 : f32;
var<private> nodeVar100 : f32;
var<private> nodeVar101 : f32;
var<private> nodeVar102 : f32;
var<private> nodeVar103 : f32;
var<private> nodeVar104 : f32;
var<private> nodeVar105 : f32;
var<private> nodeVar106 : f32;
var<private> nodeVar107 : bool;
var<private> nodeVar108 : f32;
var<private> nodeVar109 : f32;
var<private> nodeVar110 : f32;
var<private> nodeVar111 : f32;
var<private> nodeVar112 : bool;
var<private> nodeVar113 : f32;
var<private> nodeVar114 : f32;
var<private> slugOutlinedContribution : f32;
var<private> slugOutlinedAlpha : f32;
var<private> nodeVar115 : vec4<f32>;
var<private> Output : vec4<f32>;
var<private> nodeVar116 : vec4<f32>;

// codes


@fragment
fn main( @location( 0 ) slugStrokeRenderCoordinate : vec2<f32>,
	@location( 1 ) @interpolate(flat, either) nodeVarying5 : u32,
	@location( 2 ) nodeVarying6 : vec4<f32>,
	@location( 3 ) @interpolate(flat, either) nodeVarying7 : u32,
	@location( 4 ) @interpolate(flat, either) nodeVarying8 : u32,
	@location( 5 ) @interpolate(flat, either) nodeVarying9 : u32,
	@location( 6 ) @interpolate(flat, either) nodeVarying10 : u32,
	@location( 7 ) @interpolate(flat, either) nodeVarying11 : u32,
	@location( 8 ) nodeVarying12 : vec4<f32>,
	@location( 9 ) nodeVarying13 : vec4<f32>,
	@location( 10 ) nodeVarying14 : f32 ) -> OutputStruct {

	// flow
	// code

	slugEmsPerPixel = fwidth( slugStrokeRenderCoordinate );
	slugPixelsPerEmX = ( 1.0 / max( slugEmsPerPixel.x, 0.0000152587890625 ) );
	slugPixelsPerEmY = ( 1.0 / max( slugEmsPerPixel.y, 0.0000152587890625 ) );
	slugPixelsPerEm = ( ( slugPixelsPerEmX + slugPixelsPerEmY ) * 0.5 );
	nodeVar9 = textureLoad( nodeUniform4, vec2<i32>( ( i32( ( nodeVarying5 + u32( clamp( ( ( slugStrokeRenderCoordinate.y * nodeVarying6.y ) + nodeVarying6.w ), 0.0, ( f32( nodeVarying7 ) - 1.0 ) ) ) ) ) % 4096 ), ( i32( ( nodeVarying5 + u32( clamp( ( ( slugStrokeRenderCoordinate.y * nodeVarying6.y ) + nodeVarying6.w ), 0.0, ( f32( nodeVarying7 ) - 1.0 ) ) ) ) ) / 4096 ) ), u32( 0u ) );
	slugHorizontalHeader = nodeVar9.x;
	slugHorizontalReferenceOffset = ( slugHorizontalHeader & 65535u );
	slugXCoverage = 0.0;
	slugXWeight = 0.0;
	slugHorizontalCurveIndex = 0;

	while ( ( slugHorizontalCurveIndex < i32( u32( min( f32( ( slugHorizontalHeader >> 16u ) ), 512.0 ) ) ) ) ) {

		nodeVar10 = ( ( nodeVarying8 + slugHorizontalReferenceOffset ) + u32( slugHorizontalCurveIndex ) );
		nodeVar11 = textureLoad( nodeUniform5, vec2<i32>( ( i32( ( nodeVar10 >> 1u ) ) % 4096 ), ( i32( ( nodeVar10 >> 1u ) ) / 4096 ) ), u32( 0u ) );
		slugHorizontalReference = ( ( nodeVar11.x >> ( ( nodeVar10 & 1u ) * 16u ) ) & 65535u );
		nodeVar12 = ( nodeVarying9 + slugHorizontalReference );
		nodeVar13 = textureLoad( nodeUniform6, vec2<i32>( ( i32( nodeVar12 ) % 4096 ), ( i32( nodeVar12 ) / 4096 ) ), u32( 0u ) );
		slugHorizontalP0 = ( vec2<f32>( nodeVar13.x, nodeVar13.y ) - slugStrokeRenderCoordinate );
		slugHorizontalP1 = ( vec2<f32>( nodeVar13.z, nodeVar13.w ) - slugStrokeRenderCoordinate );
		nodeVar14 = textureLoad( nodeUniform6, vec2<i32>( ( i32( ( nodeVar12 + 1u ) ) % 4096 ), ( i32( ( nodeVar12 + 1u ) ) / 4096 ) ), u32( 0u ) );
		slugHorizontalP2 = ( vec2<f32>( nodeVar14.x, nodeVar14.y ) - slugStrokeRenderCoordinate );

		if ( ( ( max( max( slugHorizontalP0.x, slugHorizontalP1.x ), slugHorizontalP2.x ) * slugPixelsPerEmX ) < -0.5 ) ) {

			slugHorizontalCurveIndex = i32( u32( min( f32( ( slugHorizontalHeader >> 16u ) ), 512.0 ) ) );
			

		} else {

			slugHorizontalRootCode = ( ( 11892u >> ( ( u32( ( slugHorizontalP0.y < 0.0 ) ) | ( u32( ( slugHorizontalP1.y < 0.0 ) ) << 1u ) ) | ( u32( ( slugHorizontalP2.y < 0.0 ) ) << 2u ) ) ) & 257u );

			if ( ( f32( slugHorizontalRootCode ) > 0.0 ) ) {

				nodeVar15 = ( slugHorizontalP0.y - slugHorizontalP1.y );
				nodeVar16 = ( ( slugHorizontalP0.y - ( slugHorizontalP1.y * 2.0 ) ) + slugHorizontalP2.y );
				slugHorizontalDiscriminant = ( ( nodeVar15 * nodeVar15 ) - ( nodeVar16 * slugHorizontalP0.y ) );
				slugHorizontalPolynomialRoot1 = 0.0;
				slugHorizontalPolynomialRoot2 = 0.0;

				if ( ( abs( nodeVar16 ) < 0.0000152587890625 ) ) {

					nodeVar17 = ( slugHorizontalP0.y / ( nodeVar15 * 2.0 ) );
					slugHorizontalPolynomialRoot1 = nodeVar17;
					slugHorizontalPolynomialRoot2 = nodeVar17;
					

				} else {


					if ( ( slugHorizontalDiscriminant <= 0.0 ) ) {

						nodeVar18 = ( nodeVar15 / nodeVar16 );
						slugHorizontalPolynomialRoot1 = nodeVar18;
						slugHorizontalPolynomialRoot2 = nodeVar18;
						

					} else {

						slugHorizontalRootDistance = sqrt( slugHorizontalDiscriminant );
						slugHorizontalBPositive = ( nodeVar15 >= 0.0 );

						if ( slugHorizontalBPositive ) {

							nodeVar19 = 1.0;

						} else {

							nodeVar19 = -1.0;

						}

						slugHorizontalQ = ( nodeVar15 + ( nodeVar19 * slugHorizontalRootDistance ) );
						slugHorizontalRootA = ( slugHorizontalQ / nodeVar16 );
						slugHorizontalRootB = ( slugHorizontalP0.y / slugHorizontalQ );

						if ( slugHorizontalBPositive ) {

							nodeVar20 = slugHorizontalRootB;

						} else {

							nodeVar20 = slugHorizontalRootA;

						}

						slugHorizontalPolynomialRoot1 = nodeVar20;

						if ( slugHorizontalBPositive ) {

							nodeVar21 = slugHorizontalRootA;

						} else {

							nodeVar21 = slugHorizontalRootB;

						}

						slugHorizontalPolynomialRoot2 = nodeVar21;
						

					}

					

				}

				nodeVar22 = ( ( slugHorizontalP0.x - ( slugHorizontalP1.x * 2.0 ) ) + slugHorizontalP2.x );
				nodeVar23 = vec2<f32>( slugHorizontalPolynomialRoot1, slugHorizontalPolynomialRoot2 );
				nodeVar24 = ( ( slugHorizontalP0.x - slugHorizontalP1.x ) * 2.0 );
				nodeVar25 = vec2<f32>( ( ( ( ( nodeVar22 * nodeVar23.x ) - nodeVar24 ) * nodeVar23.x ) + slugHorizontalP0.x ), ( ( ( ( nodeVar22 * nodeVar23.y ) - nodeVar24 ) * nodeVar23.y ) + slugHorizontalP0.x ) );
				slugHorizontalRoot1 = ( nodeVar25.x * slugPixelsPerEmX );
				slugHorizontalRoot2 = ( nodeVar25.y * slugPixelsPerEmX );
				slugHorizontalHasRoot1 = ( f32( ( slugHorizontalRootCode & 1u ) ) > 0.0 );
				slugHorizontalHasRoot2 = ( f32( ( slugHorizontalRootCode & 256u ) ) > 0.0 );

				if ( slugHorizontalHasRoot1 ) {

					nodeVar26 = clamp( ( ( slugHorizontalRoot1 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar26 = 0.0;

				}


				if ( slugHorizontalHasRoot2 ) {

					nodeVar27 = clamp( ( ( slugHorizontalRoot2 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar27 = 0.0;

				}

				slugXCoverage = ( slugXCoverage + ( nodeVar26 - nodeVar27 ) );

				if ( slugHorizontalHasRoot1 ) {

					nodeVar28 = clamp( ( 1.0 - ( abs( slugHorizontalRoot1 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar28 = 0.0;

				}


				if ( slugHorizontalHasRoot2 ) {

					nodeVar29 = clamp( ( 1.0 - ( abs( slugHorizontalRoot2 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar29 = 0.0;

				}

				slugXWeight = max( slugXWeight, max( nodeVar28, nodeVar29 ) );
				

			}

			slugHorizontalCurveIndex = ( slugHorizontalCurveIndex + 1 );
			

		}


	}

	nodeVar30 = textureLoad( nodeUniform4, vec2<i32>( ( i32( ( nodeVarying10 + u32( clamp( ( ( slugStrokeRenderCoordinate.x * nodeVarying6.x ) + nodeVarying6.z ), 0.0, ( f32( nodeVarying11 ) - 1.0 ) ) ) ) ) % 4096 ), ( i32( ( nodeVarying10 + u32( clamp( ( ( slugStrokeRenderCoordinate.x * nodeVarying6.x ) + nodeVarying6.z ), 0.0, ( f32( nodeVarying11 ) - 1.0 ) ) ) ) ) / 4096 ) ), u32( 0u ) );
	slugVerticalHeader = nodeVar30.x;
	slugVerticalReferenceOffset = ( slugVerticalHeader & 65535u );
	slugYCoverage = 0.0;
	slugYWeight = 0.0;
	slugVerticalCurveIndex = 0;

	while ( ( slugVerticalCurveIndex < i32( u32( min( f32( ( slugVerticalHeader >> 16u ) ), 512.0 ) ) ) ) ) {

		nodeVar31 = ( ( nodeVarying8 + slugVerticalReferenceOffset ) + u32( slugVerticalCurveIndex ) );
		nodeVar32 = textureLoad( nodeUniform5, vec2<i32>( ( i32( ( nodeVar31 >> 1u ) ) % 4096 ), ( i32( ( nodeVar31 >> 1u ) ) / 4096 ) ), u32( 0u ) );
		slugVerticalReference = ( ( nodeVar32.x >> ( ( nodeVar31 & 1u ) * 16u ) ) & 65535u );
		nodeVar33 = ( nodeVarying9 + slugVerticalReference );
		nodeVar34 = textureLoad( nodeUniform6, vec2<i32>( ( i32( nodeVar33 ) % 4096 ), ( i32( nodeVar33 ) / 4096 ) ), u32( 0u ) );
		slugVerticalP0 = ( vec2<f32>( nodeVar34.x, nodeVar34.y ) - slugStrokeRenderCoordinate );
		slugVerticalP1 = ( vec2<f32>( nodeVar34.z, nodeVar34.w ) - slugStrokeRenderCoordinate );
		nodeVar35 = textureLoad( nodeUniform6, vec2<i32>( ( i32( ( nodeVar33 + 1u ) ) % 4096 ), ( i32( ( nodeVar33 + 1u ) ) / 4096 ) ), u32( 0u ) );
		slugVerticalP2 = ( vec2<f32>( nodeVar35.x, nodeVar35.y ) - slugStrokeRenderCoordinate );

		if ( ( ( max( max( slugVerticalP0.y, slugVerticalP1.y ), slugVerticalP2.y ) * slugPixelsPerEmY ) < -0.5 ) ) {

			slugVerticalCurveIndex = i32( u32( min( f32( ( slugVerticalHeader >> 16u ) ), 512.0 ) ) );
			

		} else {

			slugVerticalRootCode = ( ( 11892u >> ( ( u32( ( slugVerticalP0.x < 0.0 ) ) | ( u32( ( slugVerticalP1.x < 0.0 ) ) << 1u ) ) | ( u32( ( slugVerticalP2.x < 0.0 ) ) << 2u ) ) ) & 257u );

			if ( ( f32( slugVerticalRootCode ) > 0.0 ) ) {

				nodeVar36 = ( slugVerticalP0.x - slugVerticalP1.x );
				nodeVar37 = ( ( slugVerticalP0.x - ( slugVerticalP1.x * 2.0 ) ) + slugVerticalP2.x );
				slugVerticalDiscriminant = ( ( nodeVar36 * nodeVar36 ) - ( nodeVar37 * slugVerticalP0.x ) );
				slugVerticalPolynomialRoot1 = 0.0;
				slugVerticalPolynomialRoot2 = 0.0;

				if ( ( abs( nodeVar37 ) < 0.0000152587890625 ) ) {

					nodeVar38 = ( slugVerticalP0.x / ( nodeVar36 * 2.0 ) );
					slugVerticalPolynomialRoot1 = nodeVar38;
					slugVerticalPolynomialRoot2 = nodeVar38;
					

				} else {


					if ( ( slugVerticalDiscriminant <= 0.0 ) ) {

						nodeVar39 = ( nodeVar36 / nodeVar37 );
						slugVerticalPolynomialRoot1 = nodeVar39;
						slugVerticalPolynomialRoot2 = nodeVar39;
						

					} else {

						slugVerticalRootDistance = sqrt( slugVerticalDiscriminant );
						slugVerticalBPositive = ( nodeVar36 >= 0.0 );

						if ( slugVerticalBPositive ) {

							nodeVar40 = 1.0;

						} else {

							nodeVar40 = -1.0;

						}

						slugVerticalQ = ( nodeVar36 + ( nodeVar40 * slugVerticalRootDistance ) );
						slugVerticalRootA = ( slugVerticalQ / nodeVar37 );
						slugVerticalRootB = ( slugVerticalP0.x / slugVerticalQ );

						if ( slugVerticalBPositive ) {

							nodeVar41 = slugVerticalRootB;

						} else {

							nodeVar41 = slugVerticalRootA;

						}

						slugVerticalPolynomialRoot1 = nodeVar41;

						if ( slugVerticalBPositive ) {

							nodeVar42 = slugVerticalRootA;

						} else {

							nodeVar42 = slugVerticalRootB;

						}

						slugVerticalPolynomialRoot2 = nodeVar42;
						

					}

					

				}

				nodeVar43 = ( ( slugVerticalP0.y - ( slugVerticalP1.y * 2.0 ) ) + slugVerticalP2.y );
				nodeVar44 = vec2<f32>( slugVerticalPolynomialRoot1, slugVerticalPolynomialRoot2 );
				nodeVar45 = ( ( slugVerticalP0.y - slugVerticalP1.y ) * 2.0 );
				nodeVar46 = vec2<f32>( ( ( ( ( nodeVar43 * nodeVar44.x ) - nodeVar45 ) * nodeVar44.x ) + slugVerticalP0.y ), ( ( ( ( nodeVar43 * nodeVar44.y ) - nodeVar45 ) * nodeVar44.y ) + slugVerticalP0.y ) );
				slugVerticalRoot1 = ( nodeVar46.x * slugPixelsPerEmY );
				slugVerticalRoot2 = ( nodeVar46.y * slugPixelsPerEmY );
				slugVerticalHasRoot1 = ( f32( ( slugVerticalRootCode & 1u ) ) > 0.0 );
				slugVerticalHasRoot2 = ( f32( ( slugVerticalRootCode & 256u ) ) > 0.0 );

				if ( slugVerticalHasRoot2 ) {

					nodeVar47 = clamp( ( ( slugVerticalRoot2 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar47 = 0.0;

				}


				if ( slugVerticalHasRoot1 ) {

					nodeVar48 = clamp( ( ( slugVerticalRoot1 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar48 = 0.0;

				}

				slugYCoverage = ( slugYCoverage + ( nodeVar47 - nodeVar48 ) );

				if ( slugVerticalHasRoot1 ) {

					nodeVar49 = clamp( ( 1.0 - ( abs( slugVerticalRoot1 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar49 = 0.0;

				}


				if ( slugVerticalHasRoot2 ) {

					nodeVar50 = clamp( ( 1.0 - ( abs( slugVerticalRoot2 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar50 = 0.0;

				}

				slugYWeight = max( slugYWeight, max( nodeVar49, nodeVar50 ) );
				

			}

			slugVerticalCurveIndex = ( slugVerticalCurveIndex + 1 );
			

		}


	}

	slugRawCoverage = max( ( abs( ( ( slugXCoverage * slugXWeight ) + ( slugYCoverage * slugYWeight ) ) ) / max( ( slugXWeight + slugYWeight ), 0.0000152587890625 ) ), min( abs( slugXCoverage ), abs( slugYCoverage ) ) );

	if ( false ) {

		nodeVar51 = ( 1.0 - abs( ( 1.0 - ( fract( ( slugRawCoverage * 0.5 ) ) * 2.0 ) ) ) );

	} else {

		nodeVar51 = clamp( slugRawCoverage, 0.0, 1.0 );

	}

	slugCoverage = nodeVar51;

	if ( false ) {

		nodeVar52 = sqrt( slugCoverage );

	} else {

		nodeVar52 = slugCoverage;

	}

	slugCoverage = nodeVar52;
	slugOutlinedFillAlpha = ( nodeVarying12.w * slugCoverage );
	slugOutlinedOutlineAlpha = ( nodeVarying13.w * 0.0 );

	if ( ( ( slugOutlinedFillAlpha < 1.0 ) && ( ( nodeVarying14 > 0.0 ) && ( nodeVarying13.w > 0.0 ) ) ) ) {

		slugStrokeEmsPerPixel = fwidth( slugStrokeRenderCoordinate );
		slugStrokePixelEm = max( slugStrokeEmsPerPixel.x, slugStrokeEmsPerPixel.y );
		slugStrokeAaHalfWidth = ( slugStrokePixelEm * 0.5 );
		slugStrokeEffectiveHalfWidth = max( nodeVarying14, slugStrokeAaHalfWidth );
		slugStrokeSearchRadius = ( slugStrokeEffectiveHalfWidth + slugStrokeAaHalfWidth );
		slugStrokeMinimumDistance = 1.0;
		nodeVar53 = ( f32( nodeVarying7 ) - 1.0 );

		for ( var i : i32 = i32( clamp( ( ( ( slugStrokeRenderCoordinate.y - slugStrokeSearchRadius ) * nodeVarying6.y ) + nodeVarying6.w ), 0.0, ( f32( nodeVarying7 ) - 1.0 ) ) ); i < i32( ( clamp( ( ( ( slugStrokeRenderCoordinate.y + slugStrokeSearchRadius ) * nodeVarying6.y ) + nodeVarying6.w ), 0.0, nodeVar53 ) + 1.0 ) ); i ++ ) {

			nodeVar54 = textureLoad( nodeUniform4, vec2<i32>( ( i32( ( nodeVarying5 + u32( i ) ) ) % 4096 ), ( i32( ( nodeVarying5 + u32( i ) ) ) / 4096 ) ), u32( 0u ) );
			slugStrokeHorizontalHeader = nodeVar54.x;

			for ( var i : i32 = 0; i < i32( u32( min( f32( ( slugStrokeHorizontalHeader >> 16u ) ), 512.0 ) ) ); i ++ ) {

				nodeVar55 = ( ( nodeVarying8 + ( slugStrokeHorizontalHeader & 65535u ) ) + u32( i ) );
				nodeVar56 = textureLoad( nodeUniform5, vec2<i32>( ( i32( ( nodeVar55 >> 1u ) ) % 4096 ), ( i32( ( nodeVar55 >> 1u ) ) / 4096 ) ), u32( 0u ) );
				slugStrokeHorizontalReference = ( ( nodeVar56.x >> ( ( nodeVar55 & 1u ) * 16u ) ) & 65535u );
				nodeVar57 = ( nodeVarying9 + slugStrokeHorizontalReference );
				nodeVar58 = textureLoad( nodeUniform6, vec2<i32>( ( i32( ( nodeVar57 + 1u ) ) % 4096 ), ( i32( ( nodeVar57 + 1u ) ) / 4096 ) ), u32( 0u ) );
				nodeVar59 = vec2<f32>( nodeVar58.x, nodeVar58.y );
				nodeVar60 = textureLoad( nodeUniform6, vec2<i32>( ( i32( nodeVar57 ) % 4096 ), ( i32( nodeVar57 ) / 4096 ) ), u32( 0u ) );
				nodeVar61 = vec2<f32>( nodeVar60.z, nodeVar60.w );
				nodeVar62 = vec2<f32>( nodeVar60.x, nodeVar60.y );
				slugStrokeHorizontalSecondDifference = ( ( nodeVar59 - ( nodeVar61 * vec2<f32>( 2.0 ) ) ) + nodeVar62 );
				slugStrokeHorizontalInitialTangent = ( nodeVar61 - nodeVar62 );
				slugStrokeHorizontalOriginOffset = ( nodeVar62 - slugStrokeRenderCoordinate );
				slugStrokeHorizontalCubic = dot( slugStrokeHorizontalSecondDifference, slugStrokeHorizontalSecondDifference );
				slugStrokeHorizontalQuadratic = ( 3.0 * dot( slugStrokeHorizontalSecondDifference, slugStrokeHorizontalInitialTangent ) );
				slugStrokeHorizontalLinear = ( ( 2.0 * dot( slugStrokeHorizontalInitialTangent, slugStrokeHorizontalInitialTangent ) ) + dot( slugStrokeHorizontalOriginOffset, slugStrokeHorizontalSecondDifference ) );
				slugStrokeHorizontalConstant = dot( slugStrokeHorizontalOriginOffset, slugStrokeHorizontalInitialTangent );
				slugStrokeHorizontalNewtonSlope0 = ( ( ( ( ( 3.0 * slugStrokeHorizontalCubic ) * 0.5 ) * 0.5 ) + ( ( 2.0 * slugStrokeHorizontalQuadratic ) * 0.5 ) ) + slugStrokeHorizontalLinear );

				if ( ( slugStrokeHorizontalNewtonSlope0 < 0.0 ) ) {

					nodeVar63 = ( -1.0 * max( abs( slugStrokeHorizontalNewtonSlope0 ), 9.5367431640625e-7 ) );

				} else {

					nodeVar63 = max( abs( slugStrokeHorizontalNewtonSlope0 ), 9.5367431640625e-7 );

				}

				slugStrokeHorizontalClosestT = clamp( ( 0.5 - ( ( ( ( ( ( ( slugStrokeHorizontalCubic * 0.5 ) * 0.5 ) * 0.5 ) + ( ( slugStrokeHorizontalQuadratic * 0.5 ) * 0.5 ) ) + ( slugStrokeHorizontalLinear * 0.5 ) ) + slugStrokeHorizontalConstant ) / nodeVar63 ) ), 0.0, 1.0 );
				slugStrokeHorizontalNewtonSlope1 = ( ( ( ( ( 3.0 * slugStrokeHorizontalCubic ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( 2.0 * slugStrokeHorizontalQuadratic ) * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalLinear );

				if ( ( slugStrokeHorizontalNewtonSlope1 < 0.0 ) ) {

					nodeVar64 = ( -1.0 * max( abs( slugStrokeHorizontalNewtonSlope1 ), 9.5367431640625e-7 ) );

				} else {

					nodeVar64 = max( abs( slugStrokeHorizontalNewtonSlope1 ), 9.5367431640625e-7 );

				}

				slugStrokeHorizontalClosestT = clamp( ( slugStrokeHorizontalClosestT - ( ( ( ( ( ( ( slugStrokeHorizontalCubic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( slugStrokeHorizontalQuadratic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) ) + ( slugStrokeHorizontalLinear * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalConstant ) / nodeVar64 ) ), 0.0, 1.0 );
				slugStrokeHorizontalNewtonSlope2 = ( ( ( ( ( 3.0 * slugStrokeHorizontalCubic ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( 2.0 * slugStrokeHorizontalQuadratic ) * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalLinear );

				if ( ( slugStrokeHorizontalNewtonSlope2 < 0.0 ) ) {

					nodeVar65 = ( -1.0 * max( abs( slugStrokeHorizontalNewtonSlope2 ), 9.5367431640625e-7 ) );

				} else {

					nodeVar65 = max( abs( slugStrokeHorizontalNewtonSlope2 ), 9.5367431640625e-7 );

				}

				slugStrokeHorizontalClosestT = clamp( ( slugStrokeHorizontalClosestT - ( ( ( ( ( ( ( slugStrokeHorizontalCubic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( slugStrokeHorizontalQuadratic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) ) + ( slugStrokeHorizontalLinear * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalConstant ) / nodeVar65 ) ), 0.0, 1.0 );
				nodeVar68 = ( 1.0 - slugStrokeHorizontalClosestT );
				nodeVar69 = ( ( ( ( ( nodeVar68 * nodeVar68 ) * nodeVar62.x ) + ( ( ( 2.0 * nodeVar68 ) * slugStrokeHorizontalClosestT ) * nodeVar61.x ) ) + ( ( slugStrokeHorizontalClosestT * slugStrokeHorizontalClosestT ) * nodeVar59.x ) ) - slugStrokeRenderCoordinate.x );
				nodeVar70 = ( ( ( ( ( nodeVar68 * nodeVar68 ) * nodeVar62.y ) + ( ( ( 2.0 * nodeVar68 ) * slugStrokeHorizontalClosestT ) * nodeVar61.y ) ) + ( ( slugStrokeHorizontalClosestT * slugStrokeHorizontalClosestT ) * nodeVar59.y ) ) - slugStrokeRenderCoordinate.y );
				nodeVar71 = ( ( nodeVar69 * nodeVar69 ) + ( nodeVar70 * nodeVar70 ) );
				nodeVar72 = ( 1.0 - 0.0 );
				nodeVar73 = ( ( ( ( ( nodeVar72 * nodeVar72 ) * nodeVar62.x ) + ( ( ( 2.0 * nodeVar72 ) * 0.0 ) * nodeVar61.x ) ) + ( ( 0.0 * 0.0 ) * nodeVar59.x ) ) - slugStrokeRenderCoordinate.x );
				nodeVar74 = ( ( ( ( ( nodeVar72 * nodeVar72 ) * nodeVar62.y ) + ( ( ( 2.0 * nodeVar72 ) * 0.0 ) * nodeVar61.y ) ) + ( ( 0.0 * 0.0 ) * nodeVar59.y ) ) - slugStrokeRenderCoordinate.y );
				nodeVar75 = ( ( nodeVar73 * nodeVar73 ) + ( nodeVar74 * nodeVar74 ) );
				nodeVar76 = ( nodeVar71 <= nodeVar75 );

				if ( nodeVar76 ) {

					nodeVar67 = nodeVar71;

				} else {

					nodeVar67 = nodeVar75;

				}

				nodeVar77 = ( 1.0 - 1.0 );
				nodeVar78 = ( ( ( ( ( nodeVar77 * nodeVar77 ) * nodeVar62.x ) + ( ( ( 2.0 * nodeVar77 ) * 1.0 ) * nodeVar61.x ) ) + ( ( 1.0 * 1.0 ) * nodeVar59.x ) ) - slugStrokeRenderCoordinate.x );
				nodeVar79 = ( ( ( ( ( nodeVar77 * nodeVar77 ) * nodeVar62.y ) + ( ( ( 2.0 * nodeVar77 ) * 1.0 ) * nodeVar61.y ) ) + ( ( 1.0 * 1.0 ) * nodeVar59.y ) ) - slugStrokeRenderCoordinate.y );
				nodeVar80 = ( ( nodeVar78 * nodeVar78 ) + ( nodeVar79 * nodeVar79 ) );
				nodeVar81 = ( nodeVar67 <= nodeVar80 );

				if ( nodeVar81 ) {

					nodeVar66 = nodeVar67;

				} else {

					nodeVar66 = nodeVar80;

				}


				if ( nodeVar81 ) {


					if ( nodeVar76 ) {

						nodeVar83 = slugStrokeHorizontalClosestT;

					} else {

						nodeVar83 = 0.0;

					}

					nodeVar82 = nodeVar83;

				} else {

					nodeVar82 = 1.0;

				}

				slugStrokeMinimumDistance = min( slugStrokeMinimumDistance, vec2<f32>( sqrt( nodeVar66 ), nodeVar82 ).x );

			}


		}

		nodeVar84 = ( f32( nodeVarying11 ) - 1.0 );

		for ( var i : i32 = i32( clamp( ( ( ( slugStrokeRenderCoordinate.x - slugStrokeSearchRadius ) * nodeVarying6.x ) + nodeVarying6.z ), 0.0, ( f32( nodeVarying11 ) - 1.0 ) ) ); i < i32( ( clamp( ( ( ( slugStrokeRenderCoordinate.x + slugStrokeSearchRadius ) * nodeVarying6.x ) + nodeVarying6.z ), 0.0, nodeVar84 ) + 1.0 ) ); i ++ ) {

			nodeVar85 = textureLoad( nodeUniform4, vec2<i32>( ( i32( ( nodeVarying10 + u32( i ) ) ) % 4096 ), ( i32( ( nodeVarying10 + u32( i ) ) ) / 4096 ) ), u32( 0u ) );
			slugStrokeVerticalHeader = nodeVar85.x;

			for ( var i : i32 = 0; i < i32( u32( min( f32( ( slugStrokeVerticalHeader >> 16u ) ), 512.0 ) ) ); i ++ ) {

				nodeVar86 = ( ( nodeVarying8 + ( slugStrokeVerticalHeader & 65535u ) ) + u32( i ) );
				nodeVar87 = textureLoad( nodeUniform5, vec2<i32>( ( i32( ( nodeVar86 >> 1u ) ) % 4096 ), ( i32( ( nodeVar86 >> 1u ) ) / 4096 ) ), u32( 0u ) );
				slugStrokeVerticalReference = ( ( nodeVar87.x >> ( ( nodeVar86 & 1u ) * 16u ) ) & 65535u );
				nodeVar88 = ( nodeVarying9 + slugStrokeVerticalReference );
				nodeVar89 = textureLoad( nodeUniform6, vec2<i32>( ( i32( nodeVar88 ) % 4096 ), ( i32( nodeVar88 ) / 4096 ) ), u32( 0u ) );
				nodeVar90 = vec2<f32>( nodeVar89.x, nodeVar89.y );
				nodeVar91 = vec2<f32>( nodeVar89.z, nodeVar89.w );
				nodeVar92 = textureLoad( nodeUniform6, vec2<i32>( ( i32( ( nodeVar88 + 1u ) ) % 4096 ), ( i32( ( nodeVar88 + 1u ) ) / 4096 ) ), u32( 0u ) );
				nodeVar93 = vec2<f32>( nodeVar92.x, nodeVar92.y );

				if ( ( ( max( max( nodeVar90.y, nodeVar91.y ), nodeVar93.y ) - min( min( nodeVar90.y, nodeVar91.y ), nodeVar93.y ) ) <= 1e-10 ) ) {

					slugStrokeVerticalSecondDifference = ( ( nodeVar93 - ( nodeVar91 * vec2<f32>( 2.0 ) ) ) + nodeVar90 );
					slugStrokeVerticalInitialTangent = ( nodeVar91 - nodeVar90 );
					slugStrokeVerticalOriginOffset = ( nodeVar90 - slugStrokeRenderCoordinate );
					slugStrokeVerticalCubic = dot( slugStrokeVerticalSecondDifference, slugStrokeVerticalSecondDifference );
					slugStrokeVerticalQuadratic = ( 3.0 * dot( slugStrokeVerticalSecondDifference, slugStrokeVerticalInitialTangent ) );
					slugStrokeVerticalLinear = ( ( 2.0 * dot( slugStrokeVerticalInitialTangent, slugStrokeVerticalInitialTangent ) ) + dot( slugStrokeVerticalOriginOffset, slugStrokeVerticalSecondDifference ) );
					slugStrokeVerticalConstant = dot( slugStrokeVerticalOriginOffset, slugStrokeVerticalInitialTangent );
					slugStrokeVerticalNewtonSlope0 = ( ( ( ( ( 3.0 * slugStrokeVerticalCubic ) * 0.5 ) * 0.5 ) + ( ( 2.0 * slugStrokeVerticalQuadratic ) * 0.5 ) ) + slugStrokeVerticalLinear );

					if ( ( slugStrokeVerticalNewtonSlope0 < 0.0 ) ) {

						nodeVar94 = ( -1.0 * max( abs( slugStrokeVerticalNewtonSlope0 ), 9.5367431640625e-7 ) );

					} else {

						nodeVar94 = max( abs( slugStrokeVerticalNewtonSlope0 ), 9.5367431640625e-7 );

					}

					slugStrokeVerticalClosestT = clamp( ( 0.5 - ( ( ( ( ( ( ( slugStrokeVerticalCubic * 0.5 ) * 0.5 ) * 0.5 ) + ( ( slugStrokeVerticalQuadratic * 0.5 ) * 0.5 ) ) + ( slugStrokeVerticalLinear * 0.5 ) ) + slugStrokeVerticalConstant ) / nodeVar94 ) ), 0.0, 1.0 );
					slugStrokeVerticalNewtonSlope1 = ( ( ( ( ( 3.0 * slugStrokeVerticalCubic ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( 2.0 * slugStrokeVerticalQuadratic ) * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalLinear );

					if ( ( slugStrokeVerticalNewtonSlope1 < 0.0 ) ) {

						nodeVar95 = ( -1.0 * max( abs( slugStrokeVerticalNewtonSlope1 ), 9.5367431640625e-7 ) );

					} else {

						nodeVar95 = max( abs( slugStrokeVerticalNewtonSlope1 ), 9.5367431640625e-7 );

					}

					slugStrokeVerticalClosestT = clamp( ( slugStrokeVerticalClosestT - ( ( ( ( ( ( ( slugStrokeVerticalCubic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( slugStrokeVerticalQuadratic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) ) + ( slugStrokeVerticalLinear * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalConstant ) / nodeVar95 ) ), 0.0, 1.0 );
					slugStrokeVerticalNewtonSlope2 = ( ( ( ( ( 3.0 * slugStrokeVerticalCubic ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( 2.0 * slugStrokeVerticalQuadratic ) * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalLinear );

					if ( ( slugStrokeVerticalNewtonSlope2 < 0.0 ) ) {

						nodeVar96 = ( -1.0 * max( abs( slugStrokeVerticalNewtonSlope2 ), 9.5367431640625e-7 ) );

					} else {

						nodeVar96 = max( abs( slugStrokeVerticalNewtonSlope2 ), 9.5367431640625e-7 );

					}

					slugStrokeVerticalClosestT = clamp( ( slugStrokeVerticalClosestT - ( ( ( ( ( ( ( slugStrokeVerticalCubic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( slugStrokeVerticalQuadratic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) ) + ( slugStrokeVerticalLinear * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalConstant ) / nodeVar96 ) ), 0.0, 1.0 );
					nodeVar99 = ( 1.0 - slugStrokeVerticalClosestT );
					nodeVar100 = ( ( ( ( ( nodeVar99 * nodeVar99 ) * nodeVar90.x ) + ( ( ( 2.0 * nodeVar99 ) * slugStrokeVerticalClosestT ) * nodeVar91.x ) ) + ( ( slugStrokeVerticalClosestT * slugStrokeVerticalClosestT ) * nodeVar93.x ) ) - slugStrokeRenderCoordinate.x );
					nodeVar101 = ( ( ( ( ( nodeVar99 * nodeVar99 ) * nodeVar90.y ) + ( ( ( 2.0 * nodeVar99 ) * slugStrokeVerticalClosestT ) * nodeVar91.y ) ) + ( ( slugStrokeVerticalClosestT * slugStrokeVerticalClosestT ) * nodeVar93.y ) ) - slugStrokeRenderCoordinate.y );
					nodeVar102 = ( ( nodeVar100 * nodeVar100 ) + ( nodeVar101 * nodeVar101 ) );
					nodeVar103 = ( 1.0 - 0.0 );
					nodeVar104 = ( ( ( ( ( nodeVar103 * nodeVar103 ) * nodeVar90.x ) + ( ( ( 2.0 * nodeVar103 ) * 0.0 ) * nodeVar91.x ) ) + ( ( 0.0 * 0.0 ) * nodeVar93.x ) ) - slugStrokeRenderCoordinate.x );
					nodeVar105 = ( ( ( ( ( nodeVar103 * nodeVar103 ) * nodeVar90.y ) + ( ( ( 2.0 * nodeVar103 ) * 0.0 ) * nodeVar91.y ) ) + ( ( 0.0 * 0.0 ) * nodeVar93.y ) ) - slugStrokeRenderCoordinate.y );
					nodeVar106 = ( ( nodeVar104 * nodeVar104 ) + ( nodeVar105 * nodeVar105 ) );
					nodeVar107 = ( nodeVar102 <= nodeVar106 );

					if ( nodeVar107 ) {

						nodeVar98 = nodeVar102;

					} else {

						nodeVar98 = nodeVar106;

					}

					nodeVar108 = ( 1.0 - 1.0 );
					nodeVar109 = ( ( ( ( ( nodeVar108 * nodeVar108 ) * nodeVar90.x ) + ( ( ( 2.0 * nodeVar108 ) * 1.0 ) * nodeVar91.x ) ) + ( ( 1.0 * 1.0 ) * nodeVar93.x ) ) - slugStrokeRenderCoordinate.x );
					nodeVar110 = ( ( ( ( ( nodeVar108 * nodeVar108 ) * nodeVar90.y ) + ( ( ( 2.0 * nodeVar108 ) * 1.0 ) * nodeVar91.y ) ) + ( ( 1.0 * 1.0 ) * nodeVar93.y ) ) - slugStrokeRenderCoordinate.y );
					nodeVar111 = ( ( nodeVar109 * nodeVar109 ) + ( nodeVar110 * nodeVar110 ) );
					nodeVar112 = ( nodeVar98 <= nodeVar111 );

					if ( nodeVar112 ) {

						nodeVar97 = nodeVar98;

					} else {

						nodeVar97 = nodeVar111;

					}


					if ( nodeVar112 ) {


						if ( nodeVar107 ) {

							nodeVar114 = slugStrokeVerticalClosestT;

						} else {

							nodeVar114 = 0.0;

						}

						nodeVar113 = nodeVar114;

					} else {

						nodeVar113 = 1.0;

					}

					slugStrokeMinimumDistance = min( slugStrokeMinimumDistance, vec2<f32>( sqrt( nodeVar97 ), nodeVar113 ).x );
					

				}


			}


		}

		slugOutlinedOutlineAlpha = ( nodeVarying13.w * ( 1.0 - smoothstep( ( slugStrokeEffectiveHalfWidth - slugStrokeAaHalfWidth ), ( slugStrokeEffectiveHalfWidth + slugStrokeAaHalfWidth ), slugStrokeMinimumDistance ) ) );
		

	}

	slugOutlinedContribution = ( slugOutlinedOutlineAlpha * ( 1.0 - slugOutlinedFillAlpha ) );
	slugOutlinedAlpha = ( slugOutlinedFillAlpha + slugOutlinedContribution );
	nodeVar115 = vec4<f32>( ( ( ( nodeVarying12.xyz * vec3<f32>( slugOutlinedFillAlpha ) ) + ( nodeVarying13.xyz * vec3<f32>( slugOutlinedContribution ) ) ) / vec3<f32>( max( slugOutlinedAlpha, 0.0000152587890625 ) ) ), slugOutlinedAlpha );
	DiffuseColor = vec4<f32>( nodeVar115.xyz, 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * nodeVar115.w );
	nodeVar116 = max( vec4<f32>( DiffuseColor.xyz, DiffuseColor.w ), vec4<f32>( 0.0 ) );
	Output = nodeVar116;

	// result

	output.color = nodeVar116;

	return output;

}
