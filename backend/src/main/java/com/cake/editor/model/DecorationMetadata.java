package com.cake.editor.model;

public class DecorationMetadata {
    private String id;
    private String name;
    private String modelFileName;
    private String type;
    private String thumbnailUrl;
    private Boolean paintable;
    private Double initialScale;
    private Double[] initialRotation;
    private Double[] paintInitialRotation;
    private Double surfaceOffset;
    private String modelUpAxis;
    private String modelForwardAxis;
    private Boolean faceOutwardOnSides;
    private MaterialProperties material;

    public DecorationMetadata() {
    }

    public DecorationMetadata(String id, String name, String modelFileName, String type, String thumbnailUrl, Boolean paintable, Double initialScale) {
        this.id = id;
        this.name = name;
        this.modelFileName = modelFileName;
        this.type = type;
        this.thumbnailUrl = thumbnailUrl;
        this.paintable = paintable;
        this.initialScale = initialScale;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getModelFileName() {
        return modelFileName;
    }

    public void setModelFileName(String modelFileName) {
        this.modelFileName = modelFileName;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }

    public Boolean getPaintable() {
        return paintable;
    }

    public void setPaintable(Boolean paintable) {
        this.paintable = paintable;
    }

    public Double getInitialScale() {
        return initialScale;
    }

    public void setInitialScale(Double initialScale) {
        this.initialScale = initialScale;
    }

    public Double[] getInitialRotation() {
        return initialRotation;
    }

    public void setInitialRotation(Double[] initialRotation) {
        this.initialRotation = initialRotation;
    }

    public Double[] getPaintInitialRotation() {
        return paintInitialRotation;
    }

    public void setPaintInitialRotation(Double[] paintInitialRotation) {
        this.paintInitialRotation = paintInitialRotation;
    }

    public Double getSurfaceOffset() {
        return surfaceOffset;
    }

    public void setSurfaceOffset(Double surfaceOffset) {
        this.surfaceOffset = surfaceOffset;
    }

    public String getModelUpAxis() {
        return modelUpAxis;
    }

    public void setModelUpAxis(String modelUpAxis) {
        this.modelUpAxis = modelUpAxis;
    }

    public String getModelForwardAxis() {
        return modelForwardAxis;
    }

    public void setModelForwardAxis(String modelForwardAxis) {
        this.modelForwardAxis = modelForwardAxis;
    }

    public Boolean getFaceOutwardOnSides() {
        return faceOutwardOnSides;
    }

    public void setFaceOutwardOnSides(Boolean faceOutwardOnSides) {
        this.faceOutwardOnSides = faceOutwardOnSides;
    }

    public MaterialProperties getMaterial() {
        return material;
    }

    public void setMaterial(MaterialProperties material) {
        this.material = material;
    }

    public static class MaterialProperties {
        private Double roughness;
        private Double metalness;

        public MaterialProperties() {
        }

        public MaterialProperties(Double roughness, Double metalness) {
            this.roughness = roughness;
            this.metalness = metalness;
        }

        public Double getRoughness() {
            return roughness;
        }

        public void setRoughness(Double roughness) {
            this.roughness = roughness;
        }

        public Double getMetalness() {
            return metalness;
        }

        public void setMetalness(Double metalness) {
            this.metalness = metalness;
        }
    }
}
