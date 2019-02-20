import { DicomMetaDictionary } from "../DicomMetaDictionary.js";
import DerivedPixels from "./DerivedPixels";
import DerivedDataset from "./DerivedDataset";
import { Normalizer } from "../normalizers.js";

export default class Segmentation extends DerivedPixels {
    constructor(datasets, options = { includeSliceSpacing: true }) {
        super(datasets, options);
    }

    derive() {
        super.derive();

        this.assignToDataset({
            SOPClassUID: DicomMetaDictionary.sopClassUIDsByName.Segmentation,
            Modality: "SEG",
            SamplesPerPixel: "1",
            PhotometricInterpretation: "MONOCHROME2",
            BitsAllocated: "1",
            BitsStored: "1",
            HighBit: "0",
            PixelRepresentation: "0",
            LossyImageCompression: "00",
            SegmentationType: "BINARY",
            ContentLabel: "EXAMPLE"
        });

        let dimensionUID = DicomMetaDictionary.uid();
        this.dataset.DimensionOrganizationSequence = {
            DimensionOrganizationUID: dimensionUID
        };
        this.dataset.DimensionIndexSequence = [
            {
                DimensionOrganizationUID: dimensionUID,
                DimensionIndexPointer: 6422539,
                FunctionalGroupPointer: 6422538, // SegmentIdentificationSequence
                DimensionDescriptionLabel: "ReferencedSegmentNumber"
            },
            {
                DimensionOrganizationUID: dimensionUID,
                DimensionIndexPointer: 2097202,
                FunctionalGroupPointer: 2134291, // PlanePositionSequence
                DimensionDescriptionLabel: "ImagePositionPatient"
            }
        ];

        this.dataset.SegmentSequence = [];

        // TODO: check logic here.
        // If the referenced dataset itself references a series, then copy.
        // Otherwise, reference the dataset itself.
        // This should allow Slicer and others to get the correct original
        // images when loading Legacy Converted Images, but it's a workaround
        // that really doesn't belong here.
        if (this.referencedDataset.ReferencedSeriesSequence) {
            this.dataset.ReferencedSeriesSequence = DerivedDataset.copyDataset(
                this.referencedDataset.ReferencedSeriesSequence
            );
        } else {
            const ReferencedInstanceSequence = [];

            for (let i = 0; i < this.referencedDatasets.length; i++) {
                ReferencedInstanceSequence.push({
                    ReferencedSOPClassUID: this.referencedDatasets[i]
                        .SOPClassUID,
                    ReferencedSOPInstanceUID: this.referencedDatasets[i]
                        .SOPInstanceUID
                });
            }

            this.dataset.ReferencedSeriesSequence = {
                SeriesInstanceUID: this.referencedDataset.SeriesInstanceUID,
                StudyInstanceUID: this.referencedDataset.StudyInstanceUID,
                ReferencedInstanceSequence
            };
        }

        if (!this.options.includeSliceSpacing) {
            // per dciodvfy this should not be included, but dcmqi/Slicer requires it
            delete this.dataset.SharedFunctionalGroupsSequence
                .PixelMeasuresSequence.SpacingBetweenSlices;
        }

        // make an array of zeros for the pixels assuming bit packing (one bit per short)
        // TODO: handle different packing and non-multiple of 8/16 rows and columns
        // TODO: This needs to be redefined when you know how many seg frames you will have.
        this.dataset.PixelData = new ArrayBuffer(
            this.referencedDataset.PixelData.byteLength / 16
        );

        // TODO: Add frames as we add segmentations.
        this.dataset.PerFrameFunctionalGroupsSequence = [];
    }

    /**
     * addSegment - Adds a segment to the dataset.
     *
     * @param  {type} Segment                The segment metadata.
     * @param  {type} bitPackedPixelData     The bitPackedPixelData for
     *                                       each frame of the segmentation.
     * @param  {Number[]} InStackPositionNumbers  The frames which the
     *                                            segmentation references.
     */
    addSegment(Segment, bitPackedPixelData, InStackPositionNumbers) {
        this._addSegmentPixelData(bitPackedPixelData);
        const ReferencedSegmentNumber = this._addSegmentMetadata(Segment);
        this._addPerFrameFunctionalGroups(
            ReferencedSegmentNumber,
            InStackPositionNumbers
        );
    }

    _addSegmentPixelData(bitPackedPixelData) {
        const dataset = this.dataset;

        const pixelData = dataset.PixelData;

        const existingFrames = dataset.PerFrameFunctionalGroupsSequence.length;

        const offset = (existingFrames * dataset.rows * dataset.columns) / 8;

        for (let i = 0; i < bitPackedPixelData.length; i++) {
            pixelData[offset + i] = bitPackedPixelData[i];
        }
    }

    _addPerFrameFunctionalGroups(
        ReferencedSegmentNumber,
        InStackPositionNumbers
    ) {
        const PerFrameFunctionalGroupsSequence = this.dataset
            .PerFrameFunctionalGroupsSequence;

        const isMultiframe = Normalizer.isMultiframeDataset(
            this.referencedDataset
        );

        for (let i = 0; i < InStackPositionNumbers.length; i++) {
            const frameNumber = InStackPositionNumbers[i];

            const perFrameFunctionalGroups = {};

            perFrameFunctionalGroups.PlanePositionSequence = DerivedDataset.copyDataset(
                this.referencedDataset.PerFrameFunctionalGroupsSequence[
                    frameNumber - 1
                ].PlanePositionSequence
            );

            // TODO -> I think this is write, have someone check in review.
            perFrameFunctionalGroups.FrameContentSequence = {
                DimensionIndexValues: [ReferencedSegmentNumber, frameNumber]
            };

            perFrameFunctionalGroups.SegmentIdentificationSequence = {
                ReferencedSegmentNumber
            };

            let ReferencedSOPClassUID;
            let ReferencedSOPInstanceUID;
            let ReferencedFrameNumber;

            if (isMultiframe) {
                ReferencedSOPClassUID = this.referencedDataset.SOPClassUID;
                ReferencedSOPInstanceUID = this.referencedDataset
                    .SOPInstanceUID;
                ReferencedFrameNumber = frameNumber;
            } else {
                const referencedDatasetForFrame = this.referencedDatasets[
                    frameNumber - 1
                ];
                ReferencedSOPClassUID = referencedDatasetForFrame.SOPClassUID;
                ReferencedSOPInstanceUID =
                    referencedDatasetForFrame.SOPInstanceUID;
                ReferencedFrameNumber = 1;
            }

            perFrameFunctionalGroups.DerivationImageSequence = {
                SourceImageSequence: {
                    ReferencedSOPClassUID,
                    ReferencedSOPInstanceUID,
                    ReferencedFrameNumber,
                    PurposeOfReferenceCodeSequence: {
                        CodeValue: "121322",
                        CodingSchemeDesignator: "DCM",
                        CodeMeaning:
                            "Source image for image processing operation"
                    }
                },
                DerivationCodeSequence: {
                    CodeValue: "113076",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Segmentation"
                }
            };

            PerFrameFunctionalGroupsSequence.push(perFrameFunctionalGroups);
        }
    }

    _addSegmentMetadata(Segment) {
        if (
            !Segment.SegmentLabel ||
            !Segment.SegmentedPropertyCategoryCodeSequence ||
            !Segment.SegmentedPropertyTypeCodeSequence ||
            !Segment.SegmentAlgorithmType
        ) {
            throw new Error(
                `Segment does not contain all the required fields.`
            );
        }

        // Capitalise the SegmentAlgorithmType if it happens to be given in
        // Lower/mixed case.
        Segment.SegmentAlgorithmType = Segment.SegmentAlgorithmType.toUpperCase();

        // Check SegmentAlgorithmType and SegmentAlgorithmName if necessary.
        switch (Segment.SegmentAlgorithmType) {
            case "AUTOMATIC":
            case "SEMIAUTOMATIC":
                if (!Segment.SegmentAlgorithmName) {
                    throw new Error(
                        `If the SegmentAlgorithmType is SEMIAUTOMATIC or AUTOMATIC,
          SegmentAlgorithmName must be provided`
                    );
                }

                break;
            case "MANUAL":
                break;
            default:
                throw new Error(
                    `SegmentAlgorithmType ${
                        Segment.SegmentAlgorithmType
                    } invalid.`
                );
        }

        const SegmentSequence = this.dataset.SegmentSequence;
        Segment.SegmentNumber = SegmentSequence.length + 1;

        SegmentSequence.push(Segment);

        return Segment.SegmentNumber;
    }

    // TODO -> Do we really need this? A segmentation object is more something
    // you construct for output, rather than dynamic storage. Removed for now.
    /*
    removeSegment(segmentNumber) {
        const SegmentSequence = this.dataset.SegmentSequence;

        // Remove the Segment
        SegmentSequence.splice(segmentNumber - 1, 1);

        // Alter the numbering of the following Segments.
        for (let i = segmentNumber - 1; i < SegmentSequence.length; i++) {
            SegmentSequence[i].SegmentNumber = i + 1;
        }
    }
    */
}
