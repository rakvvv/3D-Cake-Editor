package com.cake.editor.model;

import jakarta.persistence.*;

import java.time.Instant;

@Entity
@Table(name = "decorated_cake_presets", uniqueConstraints = @UniqueConstraint(columnNames = "preset_id"))
public class DecoratedCakePreset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "preset_id", nullable = false, unique = true)
    private String presetId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, columnDefinition = "text")
    private String dataJson;

    @Column(length = 512)
    private String thumbnailUrl;

    private String description;

    private String cakeShape;

    private String cakeSize;

    private Integer tiers;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @PrePersist
    public void prePersist() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getPresetId() {
        return presetId;
    }

    public void setPresetId(String presetId) {
        this.presetId = presetId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDataJson() {
        return dataJson;
    }

    public void setDataJson(String dataJson) {
        this.dataJson = dataJson;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getCakeShape() {
        return cakeShape;
    }

    public void setCakeShape(String cakeShape) {
        this.cakeShape = cakeShape;
    }

    public String getCakeSize() {
        return cakeSize;
    }

    public void setCakeSize(String cakeSize) {
        this.cakeSize = cakeSize;
    }

    public Integer getTiers() {
        return tiers;
    }

    public void setTiers(Integer tiers) {
        this.tiers = tiers;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
