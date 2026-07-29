#version 300 es

// Three.js r185 - Node System


// extensions


// precision

precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp samplerCube;
precision highp sampler2DArray;

precision highp usampler2D;
precision highp usampler3D;
precision highp usamplerCube;
precision highp usampler2DArray;

precision highp isampler2D;
precision highp isampler3D;
precision highp isamplerCube;
precision highp isampler2DArray;

precision highp sampler2DShadow;
precision highp sampler2DArrayShadow;
precision highp samplerCubeShadow;


// structs

layout( location = 0 ) out vec4 fragColor;



// uniforms

layout( std140 ) uniform object {
	vec4 nodeUniform0;
	vec4 nodeUniform1;
	vec2 nodeUniform2;
	vec4 nodeUniform3;
	uint nodeUniform5;
	uint nodeUniform7;
	uint nodeUniform9;
	uint nodeUniform10;
	uint nodeUniform11;
	uint nodeUniform12;
	uint nodeUniform13;
	uint nodeUniform14;
	uint nodeUniform15;
	uint nodeUniform16;
	uint nodeUniform17;
	uint nodeUniform18;
	uint nodeUniform19;
	uint nodeUniform20;
	uint nodeUniform21;
	uint nodeUniform22;
	mat4 nodeUniform25;
};
uniform usampler2D nodeUniform4;
uniform usampler2D nodeUniform6;
uniform sampler2D nodeUniform8;

// varyings
in vec2 slugStrokeRenderCoordinate;
flat in uint nodeVarying5;
in vec4 nodeVarying6;
flat in uint nodeVarying7;
flat in uint nodeVarying8;
flat in uint nodeVarying9;
flat in uint nodeVarying10;
flat in uint nodeVarying11;
in vec4 nodeVarying12;
in vec4 nodeVarying13;
in float nodeVarying14;


// vars
vec4 DiffuseColor;
vec2 slugEmsPerPixel;
float slugPixelsPerEmX;
float slugPixelsPerEmY;
float slugPixelsPerEm;
ivec2 nodeVar9;
ivec2 nodeVar10;
bool nodeVar11;
uvec4 nodeVar12;
uint slugHorizontalHeader;
uint slugHorizontalReferenceOffset;
float slugXCoverage;
float slugXWeight;
int slugHorizontalCurveIndex;
uint nodeVar13;
ivec2 nodeVar14;
ivec2 nodeVar15;
bool nodeVar16;
uvec4 nodeVar17;
uint slugHorizontalReference;
uint nodeVar18;
ivec2 nodeVar19;
ivec2 nodeVar20;
bool nodeVar21;
vec4 nodeVar22;
vec2 slugHorizontalP0;
vec2 slugHorizontalP1;
ivec2 nodeVar23;
ivec2 nodeVar24;
bool nodeVar25;
vec4 nodeVar26;
vec2 slugHorizontalP2;
uint slugHorizontalRootCode;
float nodeVar27;
float nodeVar28;
float slugHorizontalDiscriminant;
float slugHorizontalPolynomialRoot1;
float slugHorizontalPolynomialRoot2;
float nodeVar29;
float nodeVar30;
float slugHorizontalRootDistance;
bool slugHorizontalBPositive;
float nodeVar31;
float slugHorizontalQ;
float slugHorizontalRootA;
float slugHorizontalRootB;
float nodeVar32;
float nodeVar33;
float nodeVar34;
vec2 nodeVar35;
float nodeVar36;
vec2 nodeVar37;
float slugHorizontalRoot1;
float slugHorizontalRoot2;
bool slugHorizontalHasRoot1;
bool slugHorizontalHasRoot2;
float nodeVar38;
float nodeVar39;
float nodeVar40;
float nodeVar41;
ivec2 nodeVar42;
ivec2 nodeVar43;
bool nodeVar44;
uvec4 nodeVar45;
uint slugVerticalHeader;
uint slugVerticalReferenceOffset;
float slugYCoverage;
float slugYWeight;
int slugVerticalCurveIndex;
uint nodeVar46;
ivec2 nodeVar47;
ivec2 nodeVar48;
bool nodeVar49;
uvec4 nodeVar50;
uint slugVerticalReference;
uint nodeVar51;
ivec2 nodeVar52;
ivec2 nodeVar53;
bool nodeVar54;
vec4 nodeVar55;
vec2 slugVerticalP0;
vec2 slugVerticalP1;
ivec2 nodeVar56;
ivec2 nodeVar57;
bool nodeVar58;
vec4 nodeVar59;
vec2 slugVerticalP2;
uint slugVerticalRootCode;
float nodeVar60;
float nodeVar61;
float slugVerticalDiscriminant;
float slugVerticalPolynomialRoot1;
float slugVerticalPolynomialRoot2;
float nodeVar62;
float nodeVar63;
float slugVerticalRootDistance;
bool slugVerticalBPositive;
float nodeVar64;
float slugVerticalQ;
float slugVerticalRootA;
float slugVerticalRootB;
float nodeVar65;
float nodeVar66;
float nodeVar67;
vec2 nodeVar68;
float nodeVar69;
vec2 nodeVar70;
float slugVerticalRoot1;
float slugVerticalRoot2;
bool slugVerticalHasRoot1;
bool slugVerticalHasRoot2;
float nodeVar71;
float nodeVar72;
float nodeVar73;
float nodeVar74;
float slugRawCoverage;
float nodeVar75;
float slugCoverage;
float nodeVar76;
float slugOutlinedFillAlpha;
float slugOutlinedOutlineAlpha;
vec2 slugStrokeEmsPerPixel;
float slugStrokePixelEm;
float slugStrokeAaHalfWidth;
float slugStrokeEffectiveHalfWidth;
float slugStrokeSearchRadius;
float slugStrokeMinimumDistance;
float nodeVar77;
ivec2 nodeVar78;
ivec2 nodeVar79;
bool nodeVar80;
uvec4 nodeVar81;
uint slugStrokeHorizontalHeader;
uint nodeVar82;
ivec2 nodeVar83;
ivec2 nodeVar84;
bool nodeVar85;
uvec4 nodeVar86;
uint slugStrokeHorizontalReference;
uint nodeVar87;
ivec2 nodeVar88;
ivec2 nodeVar89;
bool nodeVar90;
vec4 nodeVar91;
vec2 nodeVar92;
ivec2 nodeVar93;
ivec2 nodeVar94;
bool nodeVar95;
vec4 nodeVar96;
vec2 nodeVar97;
vec2 nodeVar98;
vec2 slugStrokeHorizontalSecondDifference;
vec2 slugStrokeHorizontalInitialTangent;
vec2 slugStrokeHorizontalOriginOffset;
float slugStrokeHorizontalCubic;
float slugStrokeHorizontalQuadratic;
float slugStrokeHorizontalLinear;
float slugStrokeHorizontalConstant;
float slugStrokeHorizontalNewtonSlope0;
float nodeVar99;
float slugStrokeHorizontalClosestT;
float slugStrokeHorizontalNewtonSlope1;
float nodeVar100;
float slugStrokeHorizontalNewtonSlope2;
float nodeVar101;
float nodeVar102;
float nodeVar103;
float nodeVar104;
float nodeVar105;
float nodeVar106;
float nodeVar107;
float nodeVar108;
float nodeVar109;
float nodeVar110;
float nodeVar111;
bool nodeVar112;
float nodeVar113;
float nodeVar114;
float nodeVar115;
float nodeVar116;
bool nodeVar117;
float nodeVar118;
float nodeVar119;
float nodeVar120;
ivec2 nodeVar121;
ivec2 nodeVar122;
bool nodeVar123;
uvec4 nodeVar124;
uint slugStrokeVerticalHeader;
uint nodeVar125;
ivec2 nodeVar126;
ivec2 nodeVar127;
bool nodeVar128;
uvec4 nodeVar129;
uint slugStrokeVerticalReference;
uint nodeVar130;
ivec2 nodeVar131;
ivec2 nodeVar132;
bool nodeVar133;
vec4 nodeVar134;
vec2 nodeVar135;
vec2 nodeVar136;
ivec2 nodeVar137;
ivec2 nodeVar138;
bool nodeVar139;
vec4 nodeVar140;
vec2 nodeVar141;
vec2 slugStrokeVerticalSecondDifference;
vec2 slugStrokeVerticalInitialTangent;
vec2 slugStrokeVerticalOriginOffset;
float slugStrokeVerticalCubic;
float slugStrokeVerticalQuadratic;
float slugStrokeVerticalLinear;
float slugStrokeVerticalConstant;
float slugStrokeVerticalNewtonSlope0;
float nodeVar142;
float slugStrokeVerticalClosestT;
float slugStrokeVerticalNewtonSlope1;
float nodeVar143;
float slugStrokeVerticalNewtonSlope2;
float nodeVar144;
float nodeVar145;
float nodeVar146;
float nodeVar147;
float nodeVar148;
float nodeVar149;
float nodeVar150;
float nodeVar151;
float nodeVar152;
float nodeVar153;
float nodeVar154;
bool nodeVar155;
float nodeVar156;
float nodeVar157;
float nodeVar158;
float nodeVar159;
bool nodeVar160;
float nodeVar161;
float nodeVar162;
float slugOutlinedContribution;
float slugOutlinedAlpha;
vec4 nodeVar163;
vec4 Output;
vec4 nodeVar164;

// codes


void main() {

	// flow
	// code

	slugEmsPerPixel = fwidth( slugStrokeRenderCoordinate );
	slugPixelsPerEmX = ( 1.0 / max( slugEmsPerPixel.x, 0.0000152587890625 ) );
	slugPixelsPerEmY = ( 1.0 / max( slugEmsPerPixel.y, 0.0000152587890625 ) );
	slugPixelsPerEm = ( ( slugPixelsPerEmX + slugPixelsPerEmY ) * 0.5 );
	nodeVar9 = ivec2( ( int( ( nodeVarying5 + uint( clamp( ( ( slugStrokeRenderCoordinate.y * nodeVarying6.y ) + nodeVarying6.w ), 0.0, ( float( nodeVarying7 ) - 1.0 ) ) ) ) ) % 4096 ), ( int( ( nodeVarying5 + uint( clamp( ( ( slugStrokeRenderCoordinate.y * nodeVarying6.y ) + nodeVarying6.w ), 0.0, ( float( nodeVarying7 ) - 1.0 ) ) ) ) ) / 4096 ) );
	nodeVar11 = bool( nodeUniform5 );

	if ( nodeVar11 ) {

		nodeVar10 = ivec2( nodeVar9.x, ( ( int( textureSize( nodeUniform4, 0 ).y ) - nodeVar9.y ) - 1 ) );

	} else {

		nodeVar10 = nodeVar9;

	}

	nodeVar12 = texelFetch( nodeUniform4, nodeVar10, int( 0 ) );
	slugHorizontalHeader = nodeVar12.x;
	slugHorizontalReferenceOffset = ( slugHorizontalHeader & 65535u );
	slugXCoverage = 0.0;
	slugXWeight = 0.0;
	slugHorizontalCurveIndex = 0;

	while ( ( slugHorizontalCurveIndex < int( uint( min( float( ( slugHorizontalHeader >> 16u ) ), 512.0 ) ) ) ) ) {

		nodeVar13 = ( ( nodeVarying8 + slugHorizontalReferenceOffset ) + uint( slugHorizontalCurveIndex ) );
		nodeVar14 = ivec2( ( int( ( nodeVar13 >> 1u ) ) % 4096 ), ( int( ( nodeVar13 >> 1u ) ) / 4096 ) );
		nodeVar16 = bool( nodeUniform7 );

		if ( nodeVar16 ) {

			nodeVar15 = ivec2( nodeVar14.x, ( ( int( textureSize( nodeUniform6, 0 ).y ) - nodeVar14.y ) - 1 ) );

		} else {

			nodeVar15 = nodeVar14;

		}

		nodeVar17 = texelFetch( nodeUniform6, nodeVar15, int( 0 ) );
		slugHorizontalReference = ( ( nodeVar17.x >> ( ( nodeVar13 & 1u ) * 16u ) ) & 65535u );
		nodeVar18 = ( nodeVarying9 + slugHorizontalReference );
		nodeVar19 = ivec2( ( int( nodeVar18 ) % 4096 ), ( int( nodeVar18 ) / 4096 ) );
		nodeVar21 = bool( nodeUniform9 );

		if ( nodeVar21 ) {

			nodeVar20 = ivec2( nodeVar19.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar19.y ) - 1 ) );

		} else {

			nodeVar20 = nodeVar19;

		}

		nodeVar22 = texelFetch( nodeUniform8, nodeVar20, int( 0 ) );
		slugHorizontalP0 = ( vec2( nodeVar22.x, nodeVar22.y ) - slugStrokeRenderCoordinate );
		slugHorizontalP1 = ( vec2( nodeVar22.z, nodeVar22.w ) - slugStrokeRenderCoordinate );
		nodeVar23 = ivec2( ( int( ( nodeVar18 + 1u ) ) % 4096 ), ( int( ( nodeVar18 + 1u ) ) / 4096 ) );
		nodeVar25 = bool( nodeUniform10 );

		if ( nodeVar25 ) {

			nodeVar24 = ivec2( nodeVar23.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar23.y ) - 1 ) );

		} else {

			nodeVar24 = nodeVar23;

		}

		nodeVar26 = texelFetch( nodeUniform8, nodeVar24, int( 0 ) );
		slugHorizontalP2 = ( vec2( nodeVar26.x, nodeVar26.y ) - slugStrokeRenderCoordinate );

		if ( ( ( max( max( slugHorizontalP0.x, slugHorizontalP1.x ), slugHorizontalP2.x ) * slugPixelsPerEmX ) < -0.5 ) ) {

			slugHorizontalCurveIndex = int( uint( min( float( ( slugHorizontalHeader >> 16u ) ), 512.0 ) ) );
			

		} else {

			slugHorizontalRootCode = ( ( 11892u >> ( ( uint( ( slugHorizontalP0.y < 0.0 ) ) | ( uint( ( slugHorizontalP1.y < 0.0 ) ) << 1u ) ) | ( uint( ( slugHorizontalP2.y < 0.0 ) ) << 2u ) ) ) & 257u );

			if ( ( float( slugHorizontalRootCode ) > 0.0 ) ) {

				nodeVar27 = ( slugHorizontalP0.y - slugHorizontalP1.y );
				nodeVar28 = ( ( slugHorizontalP0.y - ( slugHorizontalP1.y * 2.0 ) ) + slugHorizontalP2.y );
				slugHorizontalDiscriminant = ( ( nodeVar27 * nodeVar27 ) - ( nodeVar28 * slugHorizontalP0.y ) );
				slugHorizontalPolynomialRoot1 = 0.0;
				slugHorizontalPolynomialRoot2 = 0.0;

				if ( ( abs( nodeVar28 ) < 0.0000152587890625 ) ) {

					nodeVar29 = ( slugHorizontalP0.y / ( nodeVar27 * 2.0 ) );
					slugHorizontalPolynomialRoot1 = nodeVar29;
					slugHorizontalPolynomialRoot2 = nodeVar29;
					

				} else {


					if ( ( slugHorizontalDiscriminant <= 0.0 ) ) {

						nodeVar30 = ( nodeVar27 / nodeVar28 );
						slugHorizontalPolynomialRoot1 = nodeVar30;
						slugHorizontalPolynomialRoot2 = nodeVar30;
						

					} else {

						slugHorizontalRootDistance = sqrt( slugHorizontalDiscriminant );
						slugHorizontalBPositive = ( nodeVar27 >= 0.0 );

						if ( slugHorizontalBPositive ) {

							nodeVar31 = 1.0;

						} else {

							nodeVar31 = -1.0;

						}

						slugHorizontalQ = ( nodeVar27 + ( nodeVar31 * slugHorizontalRootDistance ) );
						slugHorizontalRootA = ( slugHorizontalQ / nodeVar28 );
						slugHorizontalRootB = ( slugHorizontalP0.y / slugHorizontalQ );

						if ( slugHorizontalBPositive ) {

							nodeVar32 = slugHorizontalRootB;

						} else {

							nodeVar32 = slugHorizontalRootA;

						}

						slugHorizontalPolynomialRoot1 = nodeVar32;

						if ( slugHorizontalBPositive ) {

							nodeVar33 = slugHorizontalRootA;

						} else {

							nodeVar33 = slugHorizontalRootB;

						}

						slugHorizontalPolynomialRoot2 = nodeVar33;
						

					}

					

				}

				nodeVar34 = ( ( slugHorizontalP0.x - ( slugHorizontalP1.x * 2.0 ) ) + slugHorizontalP2.x );
				nodeVar35 = vec2( slugHorizontalPolynomialRoot1, slugHorizontalPolynomialRoot2 );
				nodeVar36 = ( ( slugHorizontalP0.x - slugHorizontalP1.x ) * 2.0 );
				nodeVar37 = vec2( ( ( ( ( nodeVar34 * nodeVar35.x ) - nodeVar36 ) * nodeVar35.x ) + slugHorizontalP0.x ), ( ( ( ( nodeVar34 * nodeVar35.y ) - nodeVar36 ) * nodeVar35.y ) + slugHorizontalP0.x ) );
				slugHorizontalRoot1 = ( nodeVar37.x * slugPixelsPerEmX );
				slugHorizontalRoot2 = ( nodeVar37.y * slugPixelsPerEmX );
				slugHorizontalHasRoot1 = ( float( ( slugHorizontalRootCode & 1u ) ) > 0.0 );
				slugHorizontalHasRoot2 = ( float( ( slugHorizontalRootCode & 256u ) ) > 0.0 );

				if ( slugHorizontalHasRoot1 ) {

					nodeVar38 = clamp( ( ( slugHorizontalRoot1 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar38 = 0.0;

				}


				if ( slugHorizontalHasRoot2 ) {

					nodeVar39 = clamp( ( ( slugHorizontalRoot2 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar39 = 0.0;

				}

				slugXCoverage = ( slugXCoverage + ( nodeVar38 - nodeVar39 ) );

				if ( slugHorizontalHasRoot1 ) {

					nodeVar40 = clamp( ( 1.0 - ( abs( slugHorizontalRoot1 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar40 = 0.0;

				}


				if ( slugHorizontalHasRoot2 ) {

					nodeVar41 = clamp( ( 1.0 - ( abs( slugHorizontalRoot2 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar41 = 0.0;

				}

				slugXWeight = max( slugXWeight, max( nodeVar40, nodeVar41 ) );
				

			}

			slugHorizontalCurveIndex = ( slugHorizontalCurveIndex + 1 );
			

		}


	}

	nodeVar42 = ivec2( ( int( ( nodeVarying10 + uint( clamp( ( ( slugStrokeRenderCoordinate.x * nodeVarying6.x ) + nodeVarying6.z ), 0.0, ( float( nodeVarying11 ) - 1.0 ) ) ) ) ) % 4096 ), ( int( ( nodeVarying10 + uint( clamp( ( ( slugStrokeRenderCoordinate.x * nodeVarying6.x ) + nodeVarying6.z ), 0.0, ( float( nodeVarying11 ) - 1.0 ) ) ) ) ) / 4096 ) );
	nodeVar44 = bool( nodeUniform11 );

	if ( nodeVar44 ) {

		nodeVar43 = ivec2( nodeVar42.x, ( ( int( textureSize( nodeUniform4, 0 ).y ) - nodeVar42.y ) - 1 ) );

	} else {

		nodeVar43 = nodeVar42;

	}

	nodeVar45 = texelFetch( nodeUniform4, nodeVar43, int( 0 ) );
	slugVerticalHeader = nodeVar45.x;
	slugVerticalReferenceOffset = ( slugVerticalHeader & 65535u );
	slugYCoverage = 0.0;
	slugYWeight = 0.0;
	slugVerticalCurveIndex = 0;

	while ( ( slugVerticalCurveIndex < int( uint( min( float( ( slugVerticalHeader >> 16u ) ), 512.0 ) ) ) ) ) {

		nodeVar46 = ( ( nodeVarying8 + slugVerticalReferenceOffset ) + uint( slugVerticalCurveIndex ) );
		nodeVar47 = ivec2( ( int( ( nodeVar46 >> 1u ) ) % 4096 ), ( int( ( nodeVar46 >> 1u ) ) / 4096 ) );
		nodeVar49 = bool( nodeUniform12 );

		if ( nodeVar49 ) {

			nodeVar48 = ivec2( nodeVar47.x, ( ( int( textureSize( nodeUniform6, 0 ).y ) - nodeVar47.y ) - 1 ) );

		} else {

			nodeVar48 = nodeVar47;

		}

		nodeVar50 = texelFetch( nodeUniform6, nodeVar48, int( 0 ) );
		slugVerticalReference = ( ( nodeVar50.x >> ( ( nodeVar46 & 1u ) * 16u ) ) & 65535u );
		nodeVar51 = ( nodeVarying9 + slugVerticalReference );
		nodeVar52 = ivec2( ( int( nodeVar51 ) % 4096 ), ( int( nodeVar51 ) / 4096 ) );
		nodeVar54 = bool( nodeUniform13 );

		if ( nodeVar54 ) {

			nodeVar53 = ivec2( nodeVar52.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar52.y ) - 1 ) );

		} else {

			nodeVar53 = nodeVar52;

		}

		nodeVar55 = texelFetch( nodeUniform8, nodeVar53, int( 0 ) );
		slugVerticalP0 = ( vec2( nodeVar55.x, nodeVar55.y ) - slugStrokeRenderCoordinate );
		slugVerticalP1 = ( vec2( nodeVar55.z, nodeVar55.w ) - slugStrokeRenderCoordinate );
		nodeVar56 = ivec2( ( int( ( nodeVar51 + 1u ) ) % 4096 ), ( int( ( nodeVar51 + 1u ) ) / 4096 ) );
		nodeVar58 = bool( nodeUniform14 );

		if ( nodeVar58 ) {

			nodeVar57 = ivec2( nodeVar56.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar56.y ) - 1 ) );

		} else {

			nodeVar57 = nodeVar56;

		}

		nodeVar59 = texelFetch( nodeUniform8, nodeVar57, int( 0 ) );
		slugVerticalP2 = ( vec2( nodeVar59.x, nodeVar59.y ) - slugStrokeRenderCoordinate );

		if ( ( ( max( max( slugVerticalP0.y, slugVerticalP1.y ), slugVerticalP2.y ) * slugPixelsPerEmY ) < -0.5 ) ) {

			slugVerticalCurveIndex = int( uint( min( float( ( slugVerticalHeader >> 16u ) ), 512.0 ) ) );
			

		} else {

			slugVerticalRootCode = ( ( 11892u >> ( ( uint( ( slugVerticalP0.x < 0.0 ) ) | ( uint( ( slugVerticalP1.x < 0.0 ) ) << 1u ) ) | ( uint( ( slugVerticalP2.x < 0.0 ) ) << 2u ) ) ) & 257u );

			if ( ( float( slugVerticalRootCode ) > 0.0 ) ) {

				nodeVar60 = ( slugVerticalP0.x - slugVerticalP1.x );
				nodeVar61 = ( ( slugVerticalP0.x - ( slugVerticalP1.x * 2.0 ) ) + slugVerticalP2.x );
				slugVerticalDiscriminant = ( ( nodeVar60 * nodeVar60 ) - ( nodeVar61 * slugVerticalP0.x ) );
				slugVerticalPolynomialRoot1 = 0.0;
				slugVerticalPolynomialRoot2 = 0.0;

				if ( ( abs( nodeVar61 ) < 0.0000152587890625 ) ) {

					nodeVar62 = ( slugVerticalP0.x / ( nodeVar60 * 2.0 ) );
					slugVerticalPolynomialRoot1 = nodeVar62;
					slugVerticalPolynomialRoot2 = nodeVar62;
					

				} else {


					if ( ( slugVerticalDiscriminant <= 0.0 ) ) {

						nodeVar63 = ( nodeVar60 / nodeVar61 );
						slugVerticalPolynomialRoot1 = nodeVar63;
						slugVerticalPolynomialRoot2 = nodeVar63;
						

					} else {

						slugVerticalRootDistance = sqrt( slugVerticalDiscriminant );
						slugVerticalBPositive = ( nodeVar60 >= 0.0 );

						if ( slugVerticalBPositive ) {

							nodeVar64 = 1.0;

						} else {

							nodeVar64 = -1.0;

						}

						slugVerticalQ = ( nodeVar60 + ( nodeVar64 * slugVerticalRootDistance ) );
						slugVerticalRootA = ( slugVerticalQ / nodeVar61 );
						slugVerticalRootB = ( slugVerticalP0.x / slugVerticalQ );

						if ( slugVerticalBPositive ) {

							nodeVar65 = slugVerticalRootB;

						} else {

							nodeVar65 = slugVerticalRootA;

						}

						slugVerticalPolynomialRoot1 = nodeVar65;

						if ( slugVerticalBPositive ) {

							nodeVar66 = slugVerticalRootA;

						} else {

							nodeVar66 = slugVerticalRootB;

						}

						slugVerticalPolynomialRoot2 = nodeVar66;
						

					}

					

				}

				nodeVar67 = ( ( slugVerticalP0.y - ( slugVerticalP1.y * 2.0 ) ) + slugVerticalP2.y );
				nodeVar68 = vec2( slugVerticalPolynomialRoot1, slugVerticalPolynomialRoot2 );
				nodeVar69 = ( ( slugVerticalP0.y - slugVerticalP1.y ) * 2.0 );
				nodeVar70 = vec2( ( ( ( ( nodeVar67 * nodeVar68.x ) - nodeVar69 ) * nodeVar68.x ) + slugVerticalP0.y ), ( ( ( ( nodeVar67 * nodeVar68.y ) - nodeVar69 ) * nodeVar68.y ) + slugVerticalP0.y ) );
				slugVerticalRoot1 = ( nodeVar70.x * slugPixelsPerEmY );
				slugVerticalRoot2 = ( nodeVar70.y * slugPixelsPerEmY );
				slugVerticalHasRoot1 = ( float( ( slugVerticalRootCode & 1u ) ) > 0.0 );
				slugVerticalHasRoot2 = ( float( ( slugVerticalRootCode & 256u ) ) > 0.0 );

				if ( slugVerticalHasRoot2 ) {

					nodeVar71 = clamp( ( ( slugVerticalRoot2 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar71 = 0.0;

				}


				if ( slugVerticalHasRoot1 ) {

					nodeVar72 = clamp( ( ( slugVerticalRoot1 * 1.0 ) + 0.5 ), 0.0, 1.0 );

				} else {

					nodeVar72 = 0.0;

				}

				slugYCoverage = ( slugYCoverage + ( nodeVar71 - nodeVar72 ) );

				if ( slugVerticalHasRoot1 ) {

					nodeVar73 = clamp( ( 1.0 - ( abs( slugVerticalRoot1 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar73 = 0.0;

				}


				if ( slugVerticalHasRoot2 ) {

					nodeVar74 = clamp( ( 1.0 - ( abs( slugVerticalRoot2 ) * 2.0 ) ), 0.0, 1.0 );

				} else {

					nodeVar74 = 0.0;

				}

				slugYWeight = max( slugYWeight, max( nodeVar73, nodeVar74 ) );
				

			}

			slugVerticalCurveIndex = ( slugVerticalCurveIndex + 1 );
			

		}


	}

	slugRawCoverage = max( ( abs( ( ( slugXCoverage * slugXWeight ) + ( slugYCoverage * slugYWeight ) ) ) / max( ( slugXWeight + slugYWeight ), 0.0000152587890625 ) ), min( abs( slugXCoverage ), abs( slugYCoverage ) ) );

	if ( false ) {

		nodeVar75 = ( 1.0 - abs( ( 1.0 - ( fract( ( slugRawCoverage * 0.5 ) ) * 2.0 ) ) ) );

	} else {

		nodeVar75 = clamp( slugRawCoverage, 0.0, 1.0 );

	}

	slugCoverage = nodeVar75;

	if ( false ) {

		nodeVar76 = sqrt( slugCoverage );

	} else {

		nodeVar76 = slugCoverage;

	}

	slugCoverage = nodeVar76;
	slugOutlinedFillAlpha = ( nodeVarying12.w * slugCoverage );
	slugOutlinedOutlineAlpha = ( nodeVarying13.w * 0.0 );

	if ( ( slugOutlinedFillAlpha < 1.0 ) ) {

		slugStrokeEmsPerPixel = fwidth( slugStrokeRenderCoordinate );
		slugStrokePixelEm = max( slugStrokeEmsPerPixel.x, slugStrokeEmsPerPixel.y );
		slugStrokeAaHalfWidth = ( slugStrokePixelEm * 0.5 );
		slugStrokeEffectiveHalfWidth = max( nodeVarying14, slugStrokeAaHalfWidth );
		slugStrokeSearchRadius = ( slugStrokeEffectiveHalfWidth + slugStrokeAaHalfWidth );
		slugStrokeMinimumDistance = 1.0;
		nodeVar77 = ( float( nodeVarying7 ) - 1.0 );

		for ( int i = int( clamp( ( ( ( slugStrokeRenderCoordinate.y - slugStrokeSearchRadius ) * nodeVarying6.y ) + nodeVarying6.w ), 0.0, ( float( nodeVarying7 ) - 1.0 ) ) ); i < int( ( clamp( ( ( ( slugStrokeRenderCoordinate.y + slugStrokeSearchRadius ) * nodeVarying6.y ) + nodeVarying6.w ), 0.0, nodeVar77 ) + 1.0 ) ); i ++ ) {

			nodeVar78 = ivec2( ( int( ( nodeVarying5 + uint( i ) ) ) % 4096 ), ( int( ( nodeVarying5 + uint( i ) ) ) / 4096 ) );
			nodeVar80 = bool( nodeUniform15 );

			if ( nodeVar80 ) {

				nodeVar79 = ivec2( nodeVar78.x, ( ( int( textureSize( nodeUniform4, 0 ).y ) - nodeVar78.y ) - 1 ) );

			} else {

				nodeVar79 = nodeVar78;

			}

			nodeVar81 = texelFetch( nodeUniform4, nodeVar79, int( 0 ) );
			slugStrokeHorizontalHeader = nodeVar81.x;

			for ( int i = 0; i < int( uint( min( float( ( slugStrokeHorizontalHeader >> 16u ) ), 512.0 ) ) ); i ++ ) {

				nodeVar82 = ( ( nodeVarying8 + ( slugStrokeHorizontalHeader & 65535u ) ) + uint( i ) );
				nodeVar83 = ivec2( ( int( ( nodeVar82 >> 1u ) ) % 4096 ), ( int( ( nodeVar82 >> 1u ) ) / 4096 ) );
				nodeVar85 = bool( nodeUniform16 );

				if ( nodeVar85 ) {

					nodeVar84 = ivec2( nodeVar83.x, ( ( int( textureSize( nodeUniform6, 0 ).y ) - nodeVar83.y ) - 1 ) );

				} else {

					nodeVar84 = nodeVar83;

				}

				nodeVar86 = texelFetch( nodeUniform6, nodeVar84, int( 0 ) );
				slugStrokeHorizontalReference = ( ( nodeVar86.x >> ( ( nodeVar82 & 1u ) * 16u ) ) & 65535u );
				nodeVar87 = ( nodeVarying9 + slugStrokeHorizontalReference );
				nodeVar88 = ivec2( ( int( ( nodeVar87 + 1u ) ) % 4096 ), ( int( ( nodeVar87 + 1u ) ) / 4096 ) );
				nodeVar90 = bool( nodeUniform17 );

				if ( nodeVar90 ) {

					nodeVar89 = ivec2( nodeVar88.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar88.y ) - 1 ) );

				} else {

					nodeVar89 = nodeVar88;

				}

				nodeVar91 = texelFetch( nodeUniform8, nodeVar89, int( 0 ) );
				nodeVar92 = vec2( nodeVar91.x, nodeVar91.y );
				nodeVar93 = ivec2( ( int( nodeVar87 ) % 4096 ), ( int( nodeVar87 ) / 4096 ) );
				nodeVar95 = bool( nodeUniform18 );

				if ( nodeVar95 ) {

					nodeVar94 = ivec2( nodeVar93.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar93.y ) - 1 ) );

				} else {

					nodeVar94 = nodeVar93;

				}

				nodeVar96 = texelFetch( nodeUniform8, nodeVar94, int( 0 ) );
				nodeVar97 = vec2( nodeVar96.z, nodeVar96.w );
				nodeVar98 = vec2( nodeVar96.x, nodeVar96.y );
				slugStrokeHorizontalSecondDifference = ( ( nodeVar92 - ( nodeVar97 * vec2( 2.0 ) ) ) + nodeVar98 );
				slugStrokeHorizontalInitialTangent = ( nodeVar97 - nodeVar98 );
				slugStrokeHorizontalOriginOffset = ( nodeVar98 - slugStrokeRenderCoordinate );
				slugStrokeHorizontalCubic = dot( slugStrokeHorizontalSecondDifference, slugStrokeHorizontalSecondDifference );
				slugStrokeHorizontalQuadratic = ( 3.0 * dot( slugStrokeHorizontalSecondDifference, slugStrokeHorizontalInitialTangent ) );
				slugStrokeHorizontalLinear = ( ( 2.0 * dot( slugStrokeHorizontalInitialTangent, slugStrokeHorizontalInitialTangent ) ) + dot( slugStrokeHorizontalOriginOffset, slugStrokeHorizontalSecondDifference ) );
				slugStrokeHorizontalConstant = dot( slugStrokeHorizontalOriginOffset, slugStrokeHorizontalInitialTangent );
				slugStrokeHorizontalNewtonSlope0 = ( ( ( ( ( 3.0 * slugStrokeHorizontalCubic ) * 0.5 ) * 0.5 ) + ( ( 2.0 * slugStrokeHorizontalQuadratic ) * 0.5 ) ) + slugStrokeHorizontalLinear );

				if ( ( slugStrokeHorizontalNewtonSlope0 < 0.0 ) ) {

					nodeVar99 = ( -1.0 * max( abs( slugStrokeHorizontalNewtonSlope0 ), 9.5367431640625e-7 ) );

				} else {

					nodeVar99 = max( abs( slugStrokeHorizontalNewtonSlope0 ), 9.5367431640625e-7 );

				}

				slugStrokeHorizontalClosestT = clamp( ( 0.5 - ( ( ( ( ( ( ( slugStrokeHorizontalCubic * 0.5 ) * 0.5 ) * 0.5 ) + ( ( slugStrokeHorizontalQuadratic * 0.5 ) * 0.5 ) ) + ( slugStrokeHorizontalLinear * 0.5 ) ) + slugStrokeHorizontalConstant ) / nodeVar99 ) ), 0.0, 1.0 );
				slugStrokeHorizontalNewtonSlope1 = ( ( ( ( ( 3.0 * slugStrokeHorizontalCubic ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( 2.0 * slugStrokeHorizontalQuadratic ) * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalLinear );

				if ( ( slugStrokeHorizontalNewtonSlope1 < 0.0 ) ) {

					nodeVar100 = ( -1.0 * max( abs( slugStrokeHorizontalNewtonSlope1 ), 9.5367431640625e-7 ) );

				} else {

					nodeVar100 = max( abs( slugStrokeHorizontalNewtonSlope1 ), 9.5367431640625e-7 );

				}

				slugStrokeHorizontalClosestT = clamp( ( slugStrokeHorizontalClosestT - ( ( ( ( ( ( ( slugStrokeHorizontalCubic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( slugStrokeHorizontalQuadratic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) ) + ( slugStrokeHorizontalLinear * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalConstant ) / nodeVar100 ) ), 0.0, 1.0 );
				slugStrokeHorizontalNewtonSlope2 = ( ( ( ( ( 3.0 * slugStrokeHorizontalCubic ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( 2.0 * slugStrokeHorizontalQuadratic ) * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalLinear );

				if ( ( slugStrokeHorizontalNewtonSlope2 < 0.0 ) ) {

					nodeVar101 = ( -1.0 * max( abs( slugStrokeHorizontalNewtonSlope2 ), 9.5367431640625e-7 ) );

				} else {

					nodeVar101 = max( abs( slugStrokeHorizontalNewtonSlope2 ), 9.5367431640625e-7 );

				}

				slugStrokeHorizontalClosestT = clamp( ( slugStrokeHorizontalClosestT - ( ( ( ( ( ( ( slugStrokeHorizontalCubic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) + ( ( slugStrokeHorizontalQuadratic * slugStrokeHorizontalClosestT ) * slugStrokeHorizontalClosestT ) ) + ( slugStrokeHorizontalLinear * slugStrokeHorizontalClosestT ) ) + slugStrokeHorizontalConstant ) / nodeVar101 ) ), 0.0, 1.0 );
				nodeVar104 = ( 1.0 - slugStrokeHorizontalClosestT );
				nodeVar105 = ( ( ( ( ( nodeVar104 * nodeVar104 ) * nodeVar98.x ) + ( ( ( 2.0 * nodeVar104 ) * slugStrokeHorizontalClosestT ) * nodeVar97.x ) ) + ( ( slugStrokeHorizontalClosestT * slugStrokeHorizontalClosestT ) * nodeVar92.x ) ) - slugStrokeRenderCoordinate.x );
				nodeVar106 = ( ( ( ( ( nodeVar104 * nodeVar104 ) * nodeVar98.y ) + ( ( ( 2.0 * nodeVar104 ) * slugStrokeHorizontalClosestT ) * nodeVar97.y ) ) + ( ( slugStrokeHorizontalClosestT * slugStrokeHorizontalClosestT ) * nodeVar92.y ) ) - slugStrokeRenderCoordinate.y );
				nodeVar107 = ( ( nodeVar105 * nodeVar105 ) + ( nodeVar106 * nodeVar106 ) );
				nodeVar108 = ( 1.0 - 0.0 );
				nodeVar109 = ( ( ( ( ( nodeVar108 * nodeVar108 ) * nodeVar98.x ) + ( ( ( 2.0 * nodeVar108 ) * 0.0 ) * nodeVar97.x ) ) + ( ( 0.0 * 0.0 ) * nodeVar92.x ) ) - slugStrokeRenderCoordinate.x );
				nodeVar110 = ( ( ( ( ( nodeVar108 * nodeVar108 ) * nodeVar98.y ) + ( ( ( 2.0 * nodeVar108 ) * 0.0 ) * nodeVar97.y ) ) + ( ( 0.0 * 0.0 ) * nodeVar92.y ) ) - slugStrokeRenderCoordinate.y );
				nodeVar111 = ( ( nodeVar109 * nodeVar109 ) + ( nodeVar110 * nodeVar110 ) );
				nodeVar112 = ( nodeVar107 <= nodeVar111 );

				if ( nodeVar112 ) {

					nodeVar103 = nodeVar107;

				} else {

					nodeVar103 = nodeVar111;

				}

				nodeVar113 = ( 1.0 - 1.0 );
				nodeVar114 = ( ( ( ( ( nodeVar113 * nodeVar113 ) * nodeVar98.x ) + ( ( ( 2.0 * nodeVar113 ) * 1.0 ) * nodeVar97.x ) ) + ( ( 1.0 * 1.0 ) * nodeVar92.x ) ) - slugStrokeRenderCoordinate.x );
				nodeVar115 = ( ( ( ( ( nodeVar113 * nodeVar113 ) * nodeVar98.y ) + ( ( ( 2.0 * nodeVar113 ) * 1.0 ) * nodeVar97.y ) ) + ( ( 1.0 * 1.0 ) * nodeVar92.y ) ) - slugStrokeRenderCoordinate.y );
				nodeVar116 = ( ( nodeVar114 * nodeVar114 ) + ( nodeVar115 * nodeVar115 ) );
				nodeVar117 = ( nodeVar103 <= nodeVar116 );

				if ( nodeVar117 ) {

					nodeVar102 = nodeVar103;

				} else {

					nodeVar102 = nodeVar116;

				}


				if ( nodeVar117 ) {


					if ( nodeVar112 ) {

						nodeVar119 = slugStrokeHorizontalClosestT;

					} else {

						nodeVar119 = 0.0;

					}

					nodeVar118 = nodeVar119;

				} else {

					nodeVar118 = 1.0;

				}

				slugStrokeMinimumDistance = min( slugStrokeMinimumDistance, vec2( sqrt( nodeVar102 ), nodeVar118 ).x );

			}


		}

		nodeVar120 = ( float( nodeVarying11 ) - 1.0 );

		for ( int i = int( clamp( ( ( ( slugStrokeRenderCoordinate.x - slugStrokeSearchRadius ) * nodeVarying6.x ) + nodeVarying6.z ), 0.0, ( float( nodeVarying11 ) - 1.0 ) ) ); i < int( ( clamp( ( ( ( slugStrokeRenderCoordinate.x + slugStrokeSearchRadius ) * nodeVarying6.x ) + nodeVarying6.z ), 0.0, nodeVar120 ) + 1.0 ) ); i ++ ) {

			nodeVar121 = ivec2( ( int( ( nodeVarying10 + uint( i ) ) ) % 4096 ), ( int( ( nodeVarying10 + uint( i ) ) ) / 4096 ) );
			nodeVar123 = bool( nodeUniform19 );

			if ( nodeVar123 ) {

				nodeVar122 = ivec2( nodeVar121.x, ( ( int( textureSize( nodeUniform4, 0 ).y ) - nodeVar121.y ) - 1 ) );

			} else {

				nodeVar122 = nodeVar121;

			}

			nodeVar124 = texelFetch( nodeUniform4, nodeVar122, int( 0 ) );
			slugStrokeVerticalHeader = nodeVar124.x;

			for ( int i = 0; i < int( uint( min( float( ( slugStrokeVerticalHeader >> 16u ) ), 512.0 ) ) ); i ++ ) {

				nodeVar125 = ( ( nodeVarying8 + ( slugStrokeVerticalHeader & 65535u ) ) + uint( i ) );
				nodeVar126 = ivec2( ( int( ( nodeVar125 >> 1u ) ) % 4096 ), ( int( ( nodeVar125 >> 1u ) ) / 4096 ) );
				nodeVar128 = bool( nodeUniform20 );

				if ( nodeVar128 ) {

					nodeVar127 = ivec2( nodeVar126.x, ( ( int( textureSize( nodeUniform6, 0 ).y ) - nodeVar126.y ) - 1 ) );

				} else {

					nodeVar127 = nodeVar126;

				}

				nodeVar129 = texelFetch( nodeUniform6, nodeVar127, int( 0 ) );
				slugStrokeVerticalReference = ( ( nodeVar129.x >> ( ( nodeVar125 & 1u ) * 16u ) ) & 65535u );
				nodeVar130 = ( nodeVarying9 + slugStrokeVerticalReference );
				nodeVar131 = ivec2( ( int( nodeVar130 ) % 4096 ), ( int( nodeVar130 ) / 4096 ) );
				nodeVar133 = bool( nodeUniform21 );

				if ( nodeVar133 ) {

					nodeVar132 = ivec2( nodeVar131.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar131.y ) - 1 ) );

				} else {

					nodeVar132 = nodeVar131;

				}

				nodeVar134 = texelFetch( nodeUniform8, nodeVar132, int( 0 ) );
				nodeVar135 = vec2( nodeVar134.x, nodeVar134.y );
				nodeVar136 = vec2( nodeVar134.z, nodeVar134.w );
				nodeVar137 = ivec2( ( int( ( nodeVar130 + 1u ) ) % 4096 ), ( int( ( nodeVar130 + 1u ) ) / 4096 ) );
				nodeVar139 = bool( nodeUniform22 );

				if ( nodeVar139 ) {

					nodeVar138 = ivec2( nodeVar137.x, ( ( int( textureSize( nodeUniform8, 0 ).y ) - nodeVar137.y ) - 1 ) );

				} else {

					nodeVar138 = nodeVar137;

				}

				nodeVar140 = texelFetch( nodeUniform8, nodeVar138, int( 0 ) );
				nodeVar141 = vec2( nodeVar140.x, nodeVar140.y );

				if ( ( ( max( max( nodeVar135.y, nodeVar136.y ), nodeVar141.y ) - min( min( nodeVar135.y, nodeVar136.y ), nodeVar141.y ) ) <= 1e-10 ) ) {

					slugStrokeVerticalSecondDifference = ( ( nodeVar141 - ( nodeVar136 * vec2( 2.0 ) ) ) + nodeVar135 );
					slugStrokeVerticalInitialTangent = ( nodeVar136 - nodeVar135 );
					slugStrokeVerticalOriginOffset = ( nodeVar135 - slugStrokeRenderCoordinate );
					slugStrokeVerticalCubic = dot( slugStrokeVerticalSecondDifference, slugStrokeVerticalSecondDifference );
					slugStrokeVerticalQuadratic = ( 3.0 * dot( slugStrokeVerticalSecondDifference, slugStrokeVerticalInitialTangent ) );
					slugStrokeVerticalLinear = ( ( 2.0 * dot( slugStrokeVerticalInitialTangent, slugStrokeVerticalInitialTangent ) ) + dot( slugStrokeVerticalOriginOffset, slugStrokeVerticalSecondDifference ) );
					slugStrokeVerticalConstant = dot( slugStrokeVerticalOriginOffset, slugStrokeVerticalInitialTangent );
					slugStrokeVerticalNewtonSlope0 = ( ( ( ( ( 3.0 * slugStrokeVerticalCubic ) * 0.5 ) * 0.5 ) + ( ( 2.0 * slugStrokeVerticalQuadratic ) * 0.5 ) ) + slugStrokeVerticalLinear );

					if ( ( slugStrokeVerticalNewtonSlope0 < 0.0 ) ) {

						nodeVar142 = ( -1.0 * max( abs( slugStrokeVerticalNewtonSlope0 ), 9.5367431640625e-7 ) );

					} else {

						nodeVar142 = max( abs( slugStrokeVerticalNewtonSlope0 ), 9.5367431640625e-7 );

					}

					slugStrokeVerticalClosestT = clamp( ( 0.5 - ( ( ( ( ( ( ( slugStrokeVerticalCubic * 0.5 ) * 0.5 ) * 0.5 ) + ( ( slugStrokeVerticalQuadratic * 0.5 ) * 0.5 ) ) + ( slugStrokeVerticalLinear * 0.5 ) ) + slugStrokeVerticalConstant ) / nodeVar142 ) ), 0.0, 1.0 );
					slugStrokeVerticalNewtonSlope1 = ( ( ( ( ( 3.0 * slugStrokeVerticalCubic ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( 2.0 * slugStrokeVerticalQuadratic ) * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalLinear );

					if ( ( slugStrokeVerticalNewtonSlope1 < 0.0 ) ) {

						nodeVar143 = ( -1.0 * max( abs( slugStrokeVerticalNewtonSlope1 ), 9.5367431640625e-7 ) );

					} else {

						nodeVar143 = max( abs( slugStrokeVerticalNewtonSlope1 ), 9.5367431640625e-7 );

					}

					slugStrokeVerticalClosestT = clamp( ( slugStrokeVerticalClosestT - ( ( ( ( ( ( ( slugStrokeVerticalCubic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( slugStrokeVerticalQuadratic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) ) + ( slugStrokeVerticalLinear * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalConstant ) / nodeVar143 ) ), 0.0, 1.0 );
					slugStrokeVerticalNewtonSlope2 = ( ( ( ( ( 3.0 * slugStrokeVerticalCubic ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( 2.0 * slugStrokeVerticalQuadratic ) * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalLinear );

					if ( ( slugStrokeVerticalNewtonSlope2 < 0.0 ) ) {

						nodeVar144 = ( -1.0 * max( abs( slugStrokeVerticalNewtonSlope2 ), 9.5367431640625e-7 ) );

					} else {

						nodeVar144 = max( abs( slugStrokeVerticalNewtonSlope2 ), 9.5367431640625e-7 );

					}

					slugStrokeVerticalClosestT = clamp( ( slugStrokeVerticalClosestT - ( ( ( ( ( ( ( slugStrokeVerticalCubic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) + ( ( slugStrokeVerticalQuadratic * slugStrokeVerticalClosestT ) * slugStrokeVerticalClosestT ) ) + ( slugStrokeVerticalLinear * slugStrokeVerticalClosestT ) ) + slugStrokeVerticalConstant ) / nodeVar144 ) ), 0.0, 1.0 );
					nodeVar147 = ( 1.0 - slugStrokeVerticalClosestT );
					nodeVar148 = ( ( ( ( ( nodeVar147 * nodeVar147 ) * nodeVar135.x ) + ( ( ( 2.0 * nodeVar147 ) * slugStrokeVerticalClosestT ) * nodeVar136.x ) ) + ( ( slugStrokeVerticalClosestT * slugStrokeVerticalClosestT ) * nodeVar141.x ) ) - slugStrokeRenderCoordinate.x );
					nodeVar149 = ( ( ( ( ( nodeVar147 * nodeVar147 ) * nodeVar135.y ) + ( ( ( 2.0 * nodeVar147 ) * slugStrokeVerticalClosestT ) * nodeVar136.y ) ) + ( ( slugStrokeVerticalClosestT * slugStrokeVerticalClosestT ) * nodeVar141.y ) ) - slugStrokeRenderCoordinate.y );
					nodeVar150 = ( ( nodeVar148 * nodeVar148 ) + ( nodeVar149 * nodeVar149 ) );
					nodeVar151 = ( 1.0 - 0.0 );
					nodeVar152 = ( ( ( ( ( nodeVar151 * nodeVar151 ) * nodeVar135.x ) + ( ( ( 2.0 * nodeVar151 ) * 0.0 ) * nodeVar136.x ) ) + ( ( 0.0 * 0.0 ) * nodeVar141.x ) ) - slugStrokeRenderCoordinate.x );
					nodeVar153 = ( ( ( ( ( nodeVar151 * nodeVar151 ) * nodeVar135.y ) + ( ( ( 2.0 * nodeVar151 ) * 0.0 ) * nodeVar136.y ) ) + ( ( 0.0 * 0.0 ) * nodeVar141.y ) ) - slugStrokeRenderCoordinate.y );
					nodeVar154 = ( ( nodeVar152 * nodeVar152 ) + ( nodeVar153 * nodeVar153 ) );
					nodeVar155 = ( nodeVar150 <= nodeVar154 );

					if ( nodeVar155 ) {

						nodeVar146 = nodeVar150;

					} else {

						nodeVar146 = nodeVar154;

					}

					nodeVar156 = ( 1.0 - 1.0 );
					nodeVar157 = ( ( ( ( ( nodeVar156 * nodeVar156 ) * nodeVar135.x ) + ( ( ( 2.0 * nodeVar156 ) * 1.0 ) * nodeVar136.x ) ) + ( ( 1.0 * 1.0 ) * nodeVar141.x ) ) - slugStrokeRenderCoordinate.x );
					nodeVar158 = ( ( ( ( ( nodeVar156 * nodeVar156 ) * nodeVar135.y ) + ( ( ( 2.0 * nodeVar156 ) * 1.0 ) * nodeVar136.y ) ) + ( ( 1.0 * 1.0 ) * nodeVar141.y ) ) - slugStrokeRenderCoordinate.y );
					nodeVar159 = ( ( nodeVar157 * nodeVar157 ) + ( nodeVar158 * nodeVar158 ) );
					nodeVar160 = ( nodeVar146 <= nodeVar159 );

					if ( nodeVar160 ) {

						nodeVar145 = nodeVar146;

					} else {

						nodeVar145 = nodeVar159;

					}


					if ( nodeVar160 ) {


						if ( nodeVar155 ) {

							nodeVar162 = slugStrokeVerticalClosestT;

						} else {

							nodeVar162 = 0.0;

						}

						nodeVar161 = nodeVar162;

					} else {

						nodeVar161 = 1.0;

					}

					slugStrokeMinimumDistance = min( slugStrokeMinimumDistance, vec2( sqrt( nodeVar145 ), nodeVar161 ).x );
					

				}


			}


		}

		slugOutlinedOutlineAlpha = ( nodeVarying13.w * ( 1.0 - smoothstep( ( slugStrokeEffectiveHalfWidth - slugStrokeAaHalfWidth ), ( slugStrokeEffectiveHalfWidth + slugStrokeAaHalfWidth ), slugStrokeMinimumDistance ) ) );
		

	}

	slugOutlinedContribution = ( slugOutlinedOutlineAlpha * ( 1.0 - slugOutlinedFillAlpha ) );
	slugOutlinedAlpha = ( slugOutlinedFillAlpha + slugOutlinedContribution );
	nodeVar163 = vec4( ( ( ( nodeVarying12.xyz * vec3( slugOutlinedFillAlpha ) ) + ( nodeVarying13.xyz * vec3( slugOutlinedContribution ) ) ) / vec3( max( slugOutlinedAlpha, 0.0000152587890625 ) ) ), slugOutlinedAlpha );
	DiffuseColor = vec4( nodeVar163.xyz, 1.0 );
	DiffuseColor.w = ( DiffuseColor.w * nodeVar163.w );
	nodeVar164 = max( vec4( DiffuseColor.xyz, DiffuseColor.w ), 0.0 );
	Output = nodeVar164;

	// result
	fragColor = nodeVar164;

}
