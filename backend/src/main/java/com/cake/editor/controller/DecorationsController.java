package com.cake.editor.controller;

import com.cake.editor.model.DecorationMetadata;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping(path = "/api/decorations", produces = MediaType.APPLICATION_JSON_VALUE)
public class DecorationsController {

    @GetMapping
    public List<DecorationMetadata> decorations() {
        return List.of(
                new DecorationMetadata("sugar-flowers", "Kwiaty z lukru", "flowers", "gltf", "/assets/decorations/sugar-flowers.glb"),
                new DecorationMetadata("candle-classic", "Świeczka klasyczna", "candles", "obj", "/assets/decorations/candle-classic.obj"),
                new DecorationMetadata("topper-3d", "Topper 3D", "toppers", "stl", "/assets/decorations/topper-3d.stl")
        );
    }
}
